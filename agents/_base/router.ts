import Anthropic from "@anthropic-ai/sdk";
import { env, isCheapMode } from "../../config/env.js";
import { Models } from "../../config/models.js";
import { logger } from "../../config/logger.js";
import {
  COMPLEXITY_SIGNALS,
  ROUTING_THRESHOLDS,
  TIER_MODELS,
  type ComplexityTier,
  type RoutingDecision,
} from "../../config/routing.js";

const CLASSIFIER_PROMPT = `You are a task complexity classifier. Given a user prompt, output ONLY one of: low, medium, high.

low    = simple questions, formatting, translation, summarization, short lookups
medium = coding tasks, debugging, API design, moderate analysis, tests
high   = system architecture, deep research, security audits, ML design, comprehensive rewrites

Output exactly one word.`;

export class ModelRouter {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }

  /**
   * Routes a prompt to the appropriate model tier.
   * Uses fast heuristics first; falls back to a Haiku classifier when confidence is low.
   */
  async route(prompt: string): Promise<RoutingDecision> {
    if (isCheapMode) {
      return { model: Models.fast, tier: "low", score: 0, reason: "cheap-mode" };
    }

    const { score, signals } = this.scoreHeuristics(prompt);
    const lengthBonus = this.lengthBonus(prompt);
    const totalScore = score + lengthBonus;

    // High-confidence heuristic range: clearly low or clearly high
    const isConfident =
      totalScore <= ROUTING_THRESHOLDS.lowToMedium - 15 ||
      totalScore >= ROUTING_THRESHOLDS.mediumToHigh + 15;

    if (isConfident) {
      const tier = this.scoreTotier(totalScore);
      const decision: RoutingDecision = {
        model: TIER_MODELS[tier],
        tier,
        score: totalScore,
        reason: `heuristic [${signals.join(", ")}${lengthBonus ? `, length+${lengthBonus}` : ""}]`,
      };
      logger.debug("[router] heuristic decision", decision);
      return decision;
    }

    // Ambiguous range — ask Haiku to classify
    const tier = await this.classifyWithLLM(prompt);
    const decision: RoutingDecision = {
      model: TIER_MODELS[tier],
      tier,
      score: totalScore,
      reason: `llm-classifier (heuristic score=${totalScore})`,
    };
    logger.debug("[router] llm-classifier decision", decision);
    return decision;
  }

  private scoreHeuristics(prompt: string): { score: number; signals: string[] } {
    let score = 0;
    const signals: string[] = [];

    for (const signal of COMPLEXITY_SIGNALS) {
      if (signal.pattern.test(prompt)) {
        score += signal.delta;
        signals.push(`${signal.label}(${signal.delta > 0 ? "+" : ""}${signal.delta})`);
      }
    }

    return { score, signals };
  }

  private lengthBonus(prompt: string): number {
    const words = prompt.trim().split(/\s+/).length;
    if (words > 200) return 20;
    if (words > 100) return 10;
    if (words > 50) return 5;
    return 0;
  }

  private scoreTotier(score: number): ComplexityTier {
    if (score >= ROUTING_THRESHOLDS.mediumToHigh) return "high";
    if (score >= ROUTING_THRESHOLDS.lowToMedium) return "medium";
    return "low";
  }

  private async classifyWithLLM(prompt: string): Promise<ComplexityTier> {
    try {
      const response = await this.client.messages.create({
        model: Models.fast,
        max_tokens: 10,
        system: CLASSIFIER_PROMPT,
        messages: [{ role: "user", content: prompt.slice(0, 1000) }],
      });

      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim()
        .toLowerCase();

      if (text.startsWith("high")) return "high";
      if (text.startsWith("low")) return "low";
      return "medium";
    } catch {
      // Fallback to medium on classifier error
      return "medium";
    }
  }
}

// Singleton — one router per process
export const modelRouter = new ModelRouter();
