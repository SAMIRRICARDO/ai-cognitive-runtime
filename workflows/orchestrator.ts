import { logger } from "../config/logger.js";
import type { BaseAgent } from "../agents/_base/agent.js";
import type { AgentResult } from "../agents/_base/types.js";

export interface WorkflowStep {
  agent: BaseAgent;
  input: string | ((previousResults: AgentResult<string>[]) => string);
  name: string;
}

export interface WorkflowResult {
  steps: Array<{ name: string; result: AgentResult<string> }>;
  totalDurationMs: number;
  totalTokens: number;
}

/**
 * Sequential orchestrator — runs agents in order, passing results forward.
 */
export async function runSequential(steps: WorkflowStep[]): Promise<WorkflowResult> {
  const results: Array<{ name: string; result: AgentResult<string> }> = [];
  const startTime = Date.now();

  for (const step of steps) {
    const input =
      typeof step.input === "function" ? step.input(results.map((r) => r.result)) : step.input;

    logger.info(`[orchestrator] Running step: ${step.name}`);
    const result = await step.agent.run(input);
    results.push({ name: step.name, result });
    logger.info(`[orchestrator] Step done: ${step.name}`, { durationMs: result.durationMs });
  }

  const totalTokens = results.reduce(
    (sum, r) => sum + r.result.usage.inputTokens + r.result.usage.outputTokens,
    0
  );

  return {
    steps: results,
    totalDurationMs: Date.now() - startTime,
    totalTokens,
  };
}

/**
 * Parallel orchestrator — runs all agents concurrently.
 */
export async function runParallel(
  steps: Array<{ agent: BaseAgent; input: string; name: string }>
): Promise<WorkflowResult> {
  const startTime = Date.now();

  logger.info(`[orchestrator] Running ${steps.length} steps in parallel`);

  const settled = await Promise.allSettled(
    steps.map((step) => step.agent.run(step.input).then((result) => ({ name: step.name, result })))
  );

  const results = settled
    .filter((s): s is PromiseFulfilledResult<{ name: string; result: AgentResult<string> }> => s.status === "fulfilled")
    .map((s) => s.value);

  const totalTokens = results.reduce(
    (sum, r) => sum + r.result.usage.inputTokens + r.result.usage.outputTokens,
    0
  );

  return { steps: results, totalDurationMs: Date.now() - startTime, totalTokens };
}
