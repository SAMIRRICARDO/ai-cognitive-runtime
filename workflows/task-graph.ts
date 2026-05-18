// Pure data structure — no I/O, no Claude calls.

export type AgentName = "researcher" | "coder" | "vault" | "memory-manager";
export type TaskStatus = "pending" | "running" | "done" | "failed";

export interface TaskNode {
  id: string;
  description: string;     // may contain {otherId} placeholders
  agent: AgentName;
  dependencies: string[];
  status: TaskStatus;
  output?: string;
  error?: string;
  startedAt?: number;
  doneAt?: number;
  costUsd?: number;
}

export interface TaskGraphSpec {
  goal: string;
  tasks: Array<{
    id: string;
    description: string;
    agent: AgentName;
    dependencies: string[];
  }>;
}

export class TaskGraph {
  readonly goal: string;
  private nodes: Map<string, TaskNode>;

  constructor(spec: TaskGraphSpec) {
    this.goal = spec.goal;
    this.nodes = new Map(
      spec.tasks.map((t) => [
        t.id,
        { ...t, status: "pending" as TaskStatus },
      ])
    );
    this.validate();
  }

  // ── Mutation ──────────────────────────────────────────────────────────────────

  markRunning(id: string): void {
    this.get(id).status = "running";
    this.get(id).startedAt = Date.now();
  }

  complete(id: string, output: string, costUsd = 0): void {
    const node = this.get(id);
    node.status = "done";
    node.output = output;
    node.doneAt = Date.now();
    node.costUsd = costUsd;
  }

  fail(id: string, error: string): void {
    const node = this.get(id);
    node.status = "failed";
    node.error = error;
    node.doneAt = Date.now();
  }

  // ── Query ─────────────────────────────────────────────────────────────────────

  /** Tasks whose dependencies are all done and are still pending. */
  getReady(): TaskNode[] {
    return [...this.nodes.values()].filter(
      (n) =>
        n.status === "pending" &&
        n.dependencies.every((depId) => this.nodes.get(depId)?.status === "done")
    );
  }

  isDone(): boolean {
    return [...this.nodes.values()].every((n) => n.status === "done");
  }

  isFailed(): boolean {
    return [...this.nodes.values()].some((n) => n.status === "failed");
  }

  all(): TaskNode[] {
    return [...this.nodes.values()];
  }

  get(id: string): TaskNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Task not found: ${id}`);
    return node;
  }

  /**
   * Interpolates {taskId} placeholders in a task's description with the
   * actual output of completed dependency tasks.
   */
  resolveInput(task: TaskNode): string {
    return task.description.replace(/\{(\w+)\}/g, (_, depId) => {
      const dep = this.nodes.get(depId);
      return dep?.output ?? `[output of ${depId} not available]`;
    });
  }

  summary(): {
    total: number;
    done: number;
    failed: number;
    running: number;
    pending: number;
    totalCostUsd: number;
    totalDurationMs: number;
  } {
    const all = this.all();
    const done = all.filter((n) => n.status === "done");
    const earliest = Math.min(...done.filter((n) => n.startedAt).map((n) => n.startedAt!));
    const latest = Math.max(...done.filter((n) => n.doneAt).map((n) => n.doneAt!));

    return {
      total: all.length,
      done: done.length,
      failed: all.filter((n) => n.status === "failed").length,
      running: all.filter((n) => n.status === "running").length,
      pending: all.filter((n) => n.status === "pending").length,
      totalCostUsd: all.reduce((s, n) => s + (n.costUsd ?? 0), 0),
      totalDurationMs: done.length > 0 && isFinite(earliest) ? latest - earliest : 0,
    };
  }

  // ── Validation ────────────────────────────────────────────────────────────────

  private validate(): void {
    for (const node of this.nodes.values()) {
      for (const depId of node.dependencies) {
        if (!this.nodes.has(depId)) {
          throw new Error(`Task "${node.id}" depends on unknown task "${depId}"`);
        }
      }
    }
    if (this.hasCycle()) throw new Error("Task graph contains a dependency cycle");
  }

  private hasCycle(): boolean {
    const color = new Map<string, "white" | "gray" | "black">(
      [...this.nodes.keys()].map((id) => [id, "white"])
    );
    const dfs = (id: string): boolean => {
      color.set(id, "gray");
      for (const dep of this.nodes.get(id)!.dependencies) {
        if (color.get(dep) === "gray") return true;
        if (color.get(dep) === "white" && dfs(dep)) return true;
      }
      color.set(id, "black");
      return false;
    };
    return [...this.nodes.keys()].some((id) => color.get(id) === "white" && dfs(id));
  }
}
