import pLimit from "p-limit";
import { logger } from "../config/logger.js";
import { TaskGraph, type TaskNode } from "./task-graph.js";
import type { AgentName } from "./task-graph.js";
import { enrichTaskInput, type StepRetrievalOptions } from "./step-retrieval.js";
import { agentRegistry } from "../agents/registry.js";

// ─── Agent factory (via registry) ────────────────────────────────────────────

type AgentRunner = (input: string) => Promise<{ output: string; costUsd: number }>;

async function loadAgent(name: AgentName): Promise<AgentRunner> {
  const agent = await agentRegistry.instantiate(name);
  return async (input) => {
    const r = await agent.run(input);
    return { output: r.output, costUsd: r.cost?.totalCostUsd ?? 0 };
  };
}

// ─── Execution engine ─────────────────────────────────────────────────────────

export interface CoordinatorOptions {
  /** Max parallel tasks per wave. Default: 4 */
  concurrency?: number;
  /** Called after each task completes (or fails). */
  onTaskDone?: (task: TaskNode) => void;
  /** Automatic semantic retrieval injected into each task input before execution. */
  retrieval?: StepRetrievalOptions | false;
}

export async function executeGraph(
  graph: TaskGraph,
  opts: CoordinatorOptions = {}
): Promise<TaskGraph> {
  const concurrency = opts.concurrency ?? 4;
  const limit = pLimit(concurrency);

  // Cache agent instances so we don't re-create them per task
  const agentCache = new Map<AgentName, AgentRunner>();

  async function getRunner(name: AgentName): Promise<AgentRunner> {
    if (!agentCache.has(name)) {
      agentCache.set(name, await loadAgent(name));
    }
    return agentCache.get(name)!;
  }

  logger.info("[coordinator] starting graph", { goal: graph.goal });

  while (!graph.isDone() && !graph.isFailed()) {
    const ready = graph.getReady();
    if (ready.length === 0) {
      // No ready tasks and not done — deadlock (shouldn't happen after validate())
      logger.error("[coordinator] deadlock — no ready tasks but graph incomplete");
      break;
    }

    logger.info("[coordinator] wave", { tasks: ready.map((t) => t.id) });

    await Promise.all(
      ready.map((task) =>
        limit(async () => {
          graph.markRunning(task.id);
          const resolvedInput = graph.resolveInput(task);

          // Enrich with semantically relevant context unless disabled
          const input =
            opts.retrieval === false
              ? resolvedInput
              : await enrichTaskInput(task, resolvedInput, opts.retrieval ?? { memory: true });

          logger.info(`[coordinator] task start`, { id: task.id, agent: task.agent });

          try {
            const runner = await getRunner(task.agent);
            const { output, costUsd } = await runner(input);
            graph.complete(task.id, output, costUsd);
            logger.info(`[coordinator] task done`, { id: task.id, costUsd });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            graph.fail(task.id, msg);
            logger.error(`[coordinator] task failed`, { id: task.id, error: msg });
          }

          opts.onTaskDone?.(graph.get(task.id));
        })
      )
    );
  }

  const s = graph.summary();
  logger.info("[coordinator] graph complete", s);
  return graph;
}
