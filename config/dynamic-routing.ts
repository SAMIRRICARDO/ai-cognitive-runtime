/**
 * Dynamic routing — selects the optimal model for a task by combining:
 *   1. Complexity score (existing heuristics + LLM classifier)
 *   2. Cost budget (explicit ceiling in USD)
 *   3. Tool requirements (tool_use forces models that support it)
 *   4. Context size (long contexts require models with large windows)
 *
 * The result is a model string that can be passed to BaseAgent or any API call.
 */
import { Models } from "./models.js";
import { TIER_MODELS, type ComplexityTier, type RoutingDecision } from "./routing.js";
import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DynamicRoutingContext {
  /** The prompt or task description (used for complexity scoring). */
  prompt: string;
  /** Hard ceiling on cost per call in USD (0 = no limit). */
  budgetUsd?: number;
  /** Estimated token count of context to be sent. */
  contextTokens?: number;
  /** Tools that must be supported by the chosen model. */
  requiredTools?: string[];
  /** Prefer lower cost even at the expense of quality. */
  preferCheap?: boolean;
  /** Prefer higher quality regardless of cost. */
  preferQuality?: boolean;
}

export interface DynamicRoutingDecision extends RoutingDecision {
  /** Why each dimension contributed to the final choice. */
  factors: {
    complexity: ComplexityTier;
    budgetConstrained: boolean;
    contextConstrained: boolean;
    toolConstrained: boolean;
    preferenceOverride: "cheap" | "quality" | "none";
  };
}

// ─── Model capabilities catalogue ────────────────────────────────────────────

interface ModelSpec {
  contextWindow: number;     // max input tokens
  supportsTools: boolean;
  costPer1kInput: number;    // USD per 1k input tokens
  costPer1kOutput: number;
  tier: ComplexityTier;
}

const MODEL_SPECS: Record<string, ModelSpec> = {
  [Models.fast]: {
    contextWindow: 200_000,
    supportsTools: true,
    costPer1kInput: 0.0008,
    costPer1kOutput: 0.004,
    tier: "low",
  },
  [Models.default]: {
    contextWindow: 200_000,
    supportsTools: true,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
    tier: "medium",
  },
  [Models.powerful]: {
    contextWindow: 200_000,
    supportsTools: true,
    costPer1kInput: 0.015,
    costPer1kOutput: 0.075,
    tier: "high",
  },
};

// Ordered from cheapest to most capable
const MODEL_LADDER = [Models.fast, Models.default, Models.powerful] as const;

// ─── DynamicRouter ────────────────────────────────────────────────────────────

export class DynamicRouter {
  /**
   * Selects the best model given a set of routing constraints.
   * The complexity score sets the baseline; constraints then push
   * the choice up or down the model ladder.
   */
  async route(ctx: DynamicRoutingContext): Promise<DynamicRoutingDecision> {
    // 1. Get baseline complexity tier (reuse existing ModelRouter logic)
    const { modelRouter } = await import("../agents/_base/router.js");
    const base = await modelRouter.route(ctx.prompt);

    let chosen = TIER_MODELS[base.tier as ComplexityTier];
    const factors: DynamicRoutingDecision["factors"] = {
      complexity: base.tier as ComplexityTier,
      budgetConstrained: false,
      contextConstrained: false,
      toolConstrained: false,
      preferenceOverride: "none",
    };

    // 2. Preference override (cheapest or highest quality)
    if (ctx.preferCheap && !ctx.preferQuality) {
      chosen = Models.fast;
      factors.preferenceOverride = "cheap";
    } else if (ctx.preferQuality && !ctx.preferCheap) {
      chosen = Models.powerful;
      factors.preferenceOverride = "quality";
    }

    // 3. Context window constraint — upgrade if context is too large for chosen model
    if (ctx.contextTokens) {
      const spec = MODEL_SPECS[chosen];
      if (spec && ctx.contextTokens > spec.contextWindow * 0.85) {
        // Need a bigger window — try upgrading
        const bigger = MODEL_LADDER.find((m) => (MODEL_SPECS[m]?.contextWindow ?? 0) > ctx.contextTokens!);
        if (bigger && bigger !== chosen) {
          chosen = bigger;
          factors.contextConstrained = true;
          logger.debug(`[dynamic-router] upgraded for context size`, { tokens: ctx.contextTokens, model: chosen });
        }
      }
    }

    // 4. Tool requirement constraint
    if (ctx.requiredTools?.length) {
      const spec = MODEL_SPECS[chosen];
      if (spec && !spec.supportsTools) {
        // Upgrade to the cheapest tool-capable model
        const toolCapable = MODEL_LADDER.find((m) => MODEL_SPECS[m]?.supportsTools);
        if (toolCapable) {
          chosen = toolCapable;
          factors.toolConstrained = true;
        }
      }
    }

    // 5. Budget constraint — downgrade until estimated cost fits
    if (ctx.budgetUsd && ctx.budgetUsd > 0) {
      const estimatedOutputTokens = 1500; // reasonable default
      const totalTokens = (ctx.contextTokens ?? 500) + estimatedOutputTokens;

      for (let i = MODEL_LADDER.indexOf(chosen as typeof MODEL_LADDER[number]); i >= 0; i--) {
        const m = MODEL_LADDER[i];
        const spec = MODEL_SPECS[m];
        if (!spec) continue;
        const estimatedCost =
          (totalTokens / 1000) * spec.costPer1kInput +
          (estimatedOutputTokens / 1000) * spec.costPer1kOutput;

        if (estimatedCost <= ctx.budgetUsd) {
          if (m !== chosen) {
            factors.budgetConstrained = true;
            logger.debug(`[dynamic-router] downgraded for budget`, { budget: ctx.budgetUsd, estimatedCost, model: m });
          }
          chosen = m;
          break;
        }
      }
    }

    const finalSpec = MODEL_SPECS[chosen];
    return {
      model: chosen,
      tier: finalSpec?.tier ?? "medium",
      score: base.score,
      reason: buildReason(base.reason, factors),
      factors,
    };
  }
}

function buildReason(
  baseReason: string,
  factors: DynamicRoutingDecision["factors"]
): string {
  const parts = [baseReason];
  if (factors.preferenceOverride !== "none") parts.push(`pref=${factors.preferenceOverride}`);
  if (factors.contextConstrained) parts.push("ctx-upgrade");
  if (factors.toolConstrained) parts.push("tool-upgrade");
  if (factors.budgetConstrained) parts.push("budget-downgrade");
  return parts.join(" | ");
}

export const dynamicRouter = new DynamicRouter();
