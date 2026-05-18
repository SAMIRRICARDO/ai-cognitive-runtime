/**
 * Visual execution tracer for the task graph orchestrator.
 *
 * Renders an ASCII timeline to stdout as tasks move through
 * pending → running → done/failed states.
 *
 * Usage:
 *   const tracer = new ExecutionTracer(graph);
 *   tracer.start();
 *   // ... execute graph ...
 *   tracer.taskStarted(task);
 *   tracer.taskDone(task);
 *   tracer.finish(summary);
 */
import type { TaskNode } from "./task-graph.js";
import type { TaskGraph } from "./task-graph.js";

const ANSI = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  green:   "\x1b[32m",
  red:     "\x1b[31m",
  yellow:  "\x1b[33m",
  cyan:    "\x1b[36m",
  blue:    "\x1b[34m",
  gray:    "\x1b[90m",
} as const;

const COLOR: Record<string, string> = {
  researcher:     ANSI.blue,
  coder:          ANSI.cyan,
  vault:          ANSI.yellow,
  "memory-manager": ANSI.gray,
  coordinator:    ANSI.green,
  evaluator:      ANSI.gray,
};

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function statusIcon(status: TaskNode["status"]): string {
  switch (status) {
    case "pending":  return ANSI.gray + "○" + ANSI.reset;
    case "running":  return ANSI.yellow + "◉" + ANSI.reset;
    case "done":     return ANSI.green + "✓" + ANSI.reset;
    case "failed":   return ANSI.red + "✗" + ANSI.reset;
  }
}

function agentColor(agent: string): string {
  return (COLOR[agent] ?? "") + agent + ANSI.reset;
}

export class ExecutionTracer {
  private graph: TaskGraph;
  private startedAt: number = Date.now();

  constructor(graph: TaskGraph) {
    this.graph = graph;
  }

  /** Print the initial plan before execution starts. */
  start(): void {
    const tasks = this.graph.all();
    const width = Math.max(...tasks.map((t) => t.id.length)) + 2;

    console.log(`\n${ANSI.bold}── Task Graph ───────────────────────────────────────${ANSI.reset}`);
    console.log(`${ANSI.dim}Goal: ${this.graph.goal.slice(0, 72)}${ANSI.reset}\n`);

    for (const task of tasks) {
      const dep = task.dependencies.length
        ? ANSI.dim + `  → [${task.dependencies.join(", ")}]` + ANSI.reset
        : "";
      const icon = statusIcon(task.status);
      console.log(`  ${icon} ${pad(task.id, width)} ${agentColor(task.agent)}${dep}`);
    }

    console.log(`\n${ANSI.bold}── Execution ────────────────────────────────────────${ANSI.reset}`);
    this.startedAt = Date.now();
  }

  /** Called when a task transitions to running. */
  taskStarted(task: TaskNode): void {
    const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    const icon = statusIcon("running");
    console.log(`  ${icon} ${pad(task.id, 12)} ${agentColor(task.agent)}  ${ANSI.dim}t=${elapsed}s${ANSI.reset}`);
  }

  /** Called when a task finishes (done or failed). */
  taskDone(task: TaskNode): void {
    const elapsed = task.startedAt
      ? ((Date.now() - task.startedAt) / 1000).toFixed(1)
      : "?";
    const cost = task.costUsd ? `  $${task.costUsd.toFixed(5)}` : "";
    const icon = statusIcon(task.status);

    let line = `  ${icon} ${pad(task.id, 12)} ${agentColor(task.agent)}  ${ANSI.dim}${elapsed}s${cost}${ANSI.reset}`;

    if (task.status === "failed") {
      line += `\n    ${ANSI.red}↳ ${task.error?.slice(0, 100)}${ANSI.reset}`;
    }

    console.log(line);
  }

  /** Print final summary table. */
  finish(summary: ReturnType<TaskGraph["summary"]>): void {
    const totalSecs = (summary.totalDurationMs / 1000).toFixed(1);

    console.log(`\n${ANSI.bold}── Summary ──────────────────────────────────────────${ANSI.reset}`);

    const rows = [
      ["Tasks",    `${summary.done}/${summary.total} done` + (summary.failed ? `  ${ANSI.red}${summary.failed} failed${ANSI.reset}` : "")],
      ["Duration", `${totalSecs}s`],
      ["Cost",     `$${summary.totalCostUsd.toFixed(5)}`],
    ];

    for (const [label, value] of rows) {
      console.log(`  ${ANSI.dim}${pad(label, 10)}${ANSI.reset}${value}`);
    }

    console.log("");

    // Per-task timing breakdown
    console.log(`${ANSI.bold}── Task breakdown ───────────────────────────────────${ANSI.reset}`);
    for (const task of this.graph.all()) {
      const dur =
        task.startedAt && task.doneAt
          ? `${((task.doneAt - task.startedAt) / 1000).toFixed(1)}s`
          : "  —";
      const cost = task.costUsd ? `  $${task.costUsd.toFixed(5)}` : "";
      const icon = statusIcon(task.status);
      console.log(
        `  ${icon} ${pad(task.id, 14)} ${agentColor(task.agent).padEnd(20)}  ${pad(dur, 8)}${ANSI.dim}${cost}${ANSI.reset}`
      );
    }

    console.log("");
  }
}

/**
 * Factory: attach a tracer to CoordinatorOptions.
 * Returns updated options with onTaskDone wired to the tracer.
 */
export function withTracer(
  graph: TaskGraph,
  opts: {
    concurrency?: number;
    retrieval?: any;
    onTaskDone?: (task: TaskNode) => void;
  } = {}
): {
  tracer: ExecutionTracer;
  options: typeof opts;
} {
  const tracer = new ExecutionTracer(graph);

  const originalOnDone = opts.onTaskDone;
  const options = {
    ...opts,
    onTaskDone: (task: TaskNode) => {
      tracer.taskDone(task);
      originalOnDone?.(task);
    },
  };

  return { tracer, options };
}
