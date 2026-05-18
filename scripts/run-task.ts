#!/usr/bin/env tsx
/**
 * Multi-agent task runner.
 *
 * Usage:
 *   tsx scripts/run-task.ts "Build a REST API for a todo app"
 *   tsx scripts/run-task.ts --concurrency 2 "Research and summarise AI trends in 2025"
 *   tsx scripts/run-task.ts --dry-run "Write a CLI tool that converts CSV to JSON"
 */
import { CoordinatorAgent } from "../agents/coordinator/agent.js";
import { TaskGraph } from "../workflows/task-graph.js";
import { ExecutionTracer } from "../workflows/tracer.js";
import type { TaskNode } from "../workflows/task-graph.js";

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help")) {
  console.log(`
Usage: tsx scripts/run-task.ts [options] "<goal>"

Options:
  --concurrency <n>   Max parallel tasks (default: 4)
  --dry-run           Decompose and print the plan without executing
  --help              Show this help
`.trim());
  process.exit(0);
}

let concurrency = 4;
let dryRun = false;
const positional: string[] = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--concurrency" && args[i + 1]) {
    concurrency = parseInt(args[++i], 10);
  } else if (args[i] === "--dry-run") {
    dryRun = true;
  } else {
    positional.push(args[i]);
  }
}

const goal = positional.join(" ").trim();
if (!goal) {
  console.error("Error: goal is required");
  process.exit(1);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const coordinator = await CoordinatorAgent.create();

console.log(`\nGoal: ${goal}\n`);

if (dryRun) {
  console.log("Decomposing (dry-run)…\n");
  const spec = await coordinator.decompose(goal);
  const graph = new TaskGraph(spec);

  console.log(`Tasks (${spec.tasks.length}):\n`);
  for (const t of spec.tasks) {
    const deps = t.dependencies.length ? `  deps: [${t.dependencies.join(", ")}]` : "  deps: (none)";
    console.log(`  [${t.id}] ${t.agent}`);
    console.log(deps);
    console.log(`  ${t.description.slice(0, 120).replace(/\n/g, " ")}…\n`);
  }

  // Validation passed if we got here
  console.log("Graph valid. (--dry-run, skipping execution)");
  process.exit(0);
}

// Live execution with visual tracing
console.log("Decomposing goal…");
const spec = await coordinator.decompose(goal);
const graph = new TaskGraph(spec);
const tracer = new ExecutionTracer(graph);
tracer.start();

// Wire tracer into execution; pass graph so coordinator doesn't decompose again
const { summary, outputs } = await coordinator.runTask(goal, {
  concurrency,
  graph,
  onTaskDone: (task: TaskNode) => {
    tracer.taskDone(task);
  },
});

tracer.finish(summary);

// Print outputs
const taskIds = Object.keys(outputs);
if (taskIds.length === 1) {
  console.log("── Output ───────────────────────────────────────────\n");
  console.log(outputs[taskIds[0]]);
} else {
  for (const id of taskIds) {
    console.log(`── [${id}] ───────────────────────────────────────────\n`);
    console.log(outputs[id].slice(0, 2000));
    if (outputs[id].length > 2000) console.log(`\n… (${outputs[id].length - 2000} chars truncated)`);
    console.log("");
  }
}

process.exit(summary.failed > 0 ? 1 : 0);
