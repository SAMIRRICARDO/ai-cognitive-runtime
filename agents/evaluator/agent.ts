import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { BaseAgent } from "../_base/agent.js";
import { logger } from "../../config/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EvalDimensions {
  correctness: number;
  completeness: number;
  format: number;
  relevance: number;
}

export interface EvalResult {
  score: number;
  passed: boolean;
  dimensions: EvalDimensions;
  critique: string;
  suggestions: string[];
}

export interface ReflectionOptions {
  /** Pass threshold 0.0–1.0 (default: 0.75) */
  threshold?: number;
  /** Maximum reflection rounds (default: 3) */
  maxRounds?: number;
  /** Custom evaluation criteria injected into the prompt */
  criteria?: string;
  /** Called after each evaluation round */
  onRound?: (round: number, eval_: EvalResult, output: string) => void;
}

export interface ReflectionResult<T extends BaseAgent> {
  output: string;
  rounds: number;
  passed: boolean;
  finalEval: EvalResult;
  history: Array<{ output: string; eval: EvalResult }>;
  totalCostUsd: number;
}

// ─── EvaluatorAgent ───────────────────────────────────────────────────────────

export class EvaluatorAgent extends BaseAgent {
  constructor() {
    super({
      name: "evaluator",
      description: "Scores agent outputs against a goal and returns structured critique",
      systemPrompt: "",
      model: "auto",
      maxTokens: 1024,
      maxIterations: 2,
      enableResponseCache: false,
    });
  }

  static async create(): Promise<EvaluatorAgent> {
    const agent = new EvaluatorAgent();
    const promptPath = join(__dirname, "../../prompts/agents/evaluator.md");
    agent.config.systemPrompt = await readFile(promptPath, "utf8");
    return agent;
  }

  /**
   * Evaluate an output against a goal.
   */
  async evaluate(
    goal: string,
    output: string,
    opts: { threshold?: number; criteria?: string } = {}
  ): Promise<EvalResult> {
    const threshold = opts.threshold ?? 0.75;

    const prompt = [
      `Goal: ${goal}`,
      opts.criteria ? `Criteria: ${opts.criteria}` : "",
      `Pass threshold: ${threshold}`,
      "",
      "Output to evaluate:",
      "---",
      output.slice(0, 6000),
      output.length > 6000 ? `\n… (${output.length - 6000} chars truncated)` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const result = await this.run(prompt);
    const raw = result.output.trim();

    const jsonStr =
      raw.match(/```json\n?([\s\S]*?)\n?```/)?.[1] ??
      raw.match(/(\{[\s\S]*\})/)?.[1] ??
      raw;

    try {
      const parsed = JSON.parse(jsonStr) as Partial<EvalResult>;
      const score = parsed.score ?? 0;
      return {
        score,
        passed: parsed.passed ?? score >= threshold,
        dimensions: parsed.dimensions ?? { correctness: score, completeness: score, format: score, relevance: score },
        critique: parsed.critique ?? "",
        suggestions: parsed.suggestions ?? [],
      };
    } catch {
      logger.warn("[evaluator] parse failed — treating as failed eval", { raw: raw.slice(0, 200) });
      return {
        score: 0,
        passed: false,
        dimensions: { correctness: 0, completeness: 0, format: 0, relevance: 0 },
        critique: "Evaluator could not parse the output.",
        suggestions: ["Retry with a clearer response format."],
      };
    }
  }
}

// ─── Reflection loop ──────────────────────────────────────────────────────────

/**
 * Wraps any BaseAgent with an evaluate → reflect → retry loop.
 * The agent's output is evaluated; on failure, critique is fed back
 * as a follow-up message and the agent retries.
 *
 * @param agent   The agent to run (researcher, coder, etc.)
 * @param goal    Original user message / goal
 * @param opts    Reflection configuration
 */
export async function withReflection<T extends BaseAgent>(
  agent: T,
  goal: string,
  opts: ReflectionOptions = {}
): Promise<ReflectionResult<T>> {
  const {
    threshold = 0.75,
    maxRounds = 3,
    criteria,
    onRound,
  } = opts;

  const evaluator = await EvaluatorAgent.create();
  const history: Array<{ output: string; eval: EvalResult }> = [];
  let totalCostUsd = 0;

  let currentPrompt = goal;

  for (let round = 1; round <= maxRounds; round++) {
    logger.info(`[reflection] round ${round}`, { goal: goal.slice(0, 60) });

    const agentResult = await agent.run(currentPrompt);
    const output = agentResult.output;
    totalCostUsd += agentResult.cost?.totalCostUsd ?? 0;

    const evaluation = await evaluator.evaluate(goal, output, { threshold, criteria });
    totalCostUsd += evaluation.passed ? 0 : (evaluator as any).lastCostUsd ?? 0;

    history.push({ output, eval: evaluation });
    onRound?.(round, evaluation, output);

    logger.info(`[reflection] round ${round} score=${evaluation.score.toFixed(2)} passed=${evaluation.passed}`, {
      critique: evaluation.critique.slice(0, 100),
    });

    if (evaluation.passed) {
      return {
        output,
        rounds: round,
        passed: true,
        finalEval: evaluation,
        history,
        totalCostUsd,
      };
    }

    if (round < maxRounds) {
      // Build the reflection prompt: original goal + critique + suggestions
      const suggestionBlock =
        evaluation.suggestions.length > 0
          ? `\nSpecific improvements needed:\n${evaluation.suggestions.map((s) => `- ${s}`).join("\n")}`
          : "";

      currentPrompt = [
        `Original goal: ${goal}`,
        "",
        `Your previous response did not meet the quality bar (score: ${evaluation.score.toFixed(2)}).`,
        `Critique: ${evaluation.critique}`,
        suggestionBlock,
        "",
        "Please revise your response addressing the feedback above.",
      ]
        .filter((l) => l !== undefined)
        .join("\n");
    }
  }

  // Exhausted rounds — return best attempt
  const best = history.reduce((a, b) => (a.eval.score >= b.eval.score ? a : b));
  return {
    output: best.output,
    rounds: maxRounds,
    passed: false,
    finalEval: best.eval,
    history,
    totalCostUsd,
  };
}
