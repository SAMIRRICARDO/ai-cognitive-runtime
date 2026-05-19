import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { BaseAgent } from "../_base/agent.js";
import { getMaxTokens } from "../../config/models.js";
import { TaskGraph, type TaskGraphSpec } from "../../workflows/task-graph.js";
import { executeGraph, type CoordinatorOptions } from "../../workflows/coordinator.js";
import { logger } from "../../config/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export class CoordinatorAgent extends BaseAgent {
  constructor() {
    super({
      name: "coordinator",
      description: "Decomposes goals into multi-agent task graphs and orchestrates execution",
      systemPrompt: "",
      model: "auto",
      maxTokens: getMaxTokens(4096),
      maxIterations: 3,
    });
  }

  static async create(): Promise<CoordinatorAgent> {
    const agent = new CoordinatorAgent();
    const promptPath = join(__dirname, "../../prompts/agents/coordinator.md");
    agent.config.systemPrompt = await readFile(promptPath, "utf8");
    return agent;
  }

  /**
   * Decompose a goal into a TaskGraphSpec by asking Claude to plan.
   * Retries up to 2 times if the response is not valid JSON.
   */
  async decompose(goal: string): Promise<TaskGraphSpec> {
    const prompt = `Goal: ${goal}\n\nReturn the task graph JSON only.`;

    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await this.run(prompt);
      const raw = result.output.trim();

      // Extract JSON — handle markdown code fences
      const jsonStr =
        raw.match(/```json\n?([\s\S]*?)\n?```/)?.[1] ??
        raw.match(/(\{[\s\S]*\})/)?.[1] ??
        raw;

      try {
        const spec = JSON.parse(jsonStr) as TaskGraphSpec;
        if (!spec.goal || !Array.isArray(spec.tasks)) {
          throw new Error("Missing goal or tasks array");
        }
        // Validate each task has required fields
        for (const t of spec.tasks) {
          if (!t.id || !t.description || !t.agent || !Array.isArray(t.dependencies)) {
            throw new Error(`Task missing required fields: ${JSON.stringify(t)}`);
          }
        }
        logger.info("[coordinator] decomposed", { goal, tasks: spec.tasks.length });
        return spec;
      } catch (err) {
        logger.warn(`[coordinator] parse attempt ${attempt} failed`, { err, raw: raw.slice(0, 200) });
        if (attempt === 3) throw new Error(`Failed to decompose goal after 3 attempts: ${err}`);
      }
    }

    throw new Error("Unreachable");
  }

  /**
   * Full pipeline: decompose goal → build TaskGraph → execute → synthesize.
   */
  async run(
    userMessage: string,
    options: Parameters<BaseAgent["run"]>[1] = {}
  ): ReturnType<BaseAgent["run"]> {
    return super.run(userMessage, options);
  }

  /**
   * Decompose + execute + return results summary.
   * Pass a pre-built `graph` to skip decomposition (e.g. when the caller
   * already built one for tracing purposes).
   */
  async runTask(
    goal: string,
    coordinatorOptions: CoordinatorOptions & { graph?: TaskGraph } = {}
  ): Promise<{
    goal: string;
    graph: TaskGraph;
    summary: ReturnType<TaskGraph["summary"]>;
    outputs: Record<string, string>;
  }> {
    const graph = coordinatorOptions.graph ?? new TaskGraph(await this.decompose(goal));

    await executeGraph(graph, {
      ...coordinatorOptions,
      onTaskDone: (task) => {
        const status = task.status === "done" ? "✓" : "✗";
        logger.info(`[coordinator] ${status} ${task.id} (${task.agent})`, {
          costUsd: task.costUsd,
          durationMs: task.doneAt && task.startedAt ? task.doneAt - task.startedAt : undefined,
        });
        coordinatorOptions.onTaskDone?.(task);
      },
    });

    const outputs: Record<string, string> = {};
    for (const task of graph.all()) {
      if (task.output) outputs[task.id] = task.output;
    }

    return { goal, graph, summary: graph.summary(), outputs };
  }
}
