#!/usr/bin/env tsx
/**
 * Batch evaluation runner.
 *
 * Usage:
 *   tsx scripts/run-eval.ts <agent> --cases evals/cases.json
 *   tsx scripts/run-eval.ts coder --cases evals/coder.json --rounds 2 --threshold 0.8
 *
 * cases.json format:
 *   [
 *     { "id": "case-1", "goal": "...", "criteria": "..." },
 *     ...
 *   ]
 */
import { readFile } from "fs/promises";
import { ResearcherAgent } from "../agents/researcher/agent.js";
import { CoderAgent } from "../agents/coder/agent.js";
import { VaultAgent } from "../agents/vault/agent.js";
import { withReflection, type EvalResult } from "../agents/evaluator/agent.js";

const args = process.argv.slice(2);
const agentName = args[0];

let casesPath = "";
let rounds = 3;
let threshold = 0.75;

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--cases") casesPath = args[++i];
  else if (args[i] === "--rounds") rounds = parseInt(args[++i], 10);
  else if (args[i] === "--threshold") threshold = parseFloat(args[++i]);
}

if (!agentName || !casesPath) {
  console.error(`
Usage: tsx scripts/run-eval.ts <agent> --cases <file.json> [--rounds n] [--threshold 0.0-1.0]
  `.trim());
  process.exit(1);
}

interface EvalCase {
  id: string;
  goal: string;
  criteria?: string;
}

const cases: EvalCase[] = JSON.parse(await readFile(casesPath, "utf8"));

const factories: Record<string, () => Promise<any>> = {
  researcher: () => ResearcherAgent.create(),
  coder: () => CoderAgent.create(),
  vault: () => VaultAgent.create(),
};

const factory = factories[agentName];
if (!factory) {
  console.error(`Unknown agent: ${agentName}. Available: ${Object.keys(factories).join(", ")}`);
  process.exit(1);
}

console.log(`\nEvaluating ${cases.length} case(s) with ${agentName} | rounds=${rounds} threshold=${threshold}\n`);

const results: Array<{
  id: string;
  passed: boolean;
  score: number;
  rounds: number;
  finalEval: EvalResult;
  totalCostUsd: number;
}> = [];

for (const c of cases) {
  process.stdout.write(`  [${c.id}] … `);
  const agent = await factory();

  const r = await withReflection(agent, c.goal, {
    maxRounds: rounds,
    threshold,
    criteria: c.criteria,
  });

  results.push({
    id: c.id,
    passed: r.passed,
    score: r.finalEval.score,
    rounds: r.rounds,
    finalEval: r.finalEval,
    totalCostUsd: r.totalCostUsd,
  });

  const icon = r.passed ? "✓" : "✗";
  console.log(`${icon} score=${r.finalEval.score.toFixed(2)} rounds=${r.rounds} $${r.totalCostUsd.toFixed(5)}`);
}

// Summary
const passed = results.filter((r) => r.passed).length;
const totalCost = results.reduce((s, r) => s + r.totalCostUsd, 0);
const avgScore = results.reduce((s, r) => s + r.score, 0) / results.length;

console.log(`
─── Eval Summary ────────────────────────────────────
  Cases     : ${cases.length}
  Passed    : ${passed} / ${cases.length} (${((passed / cases.length) * 100).toFixed(0)}%)
  Avg score : ${avgScore.toFixed(3)}
  Total cost: $${totalCost.toFixed(5)}
─────────────────────────────────────────────────────
`);

const failed = results.filter((r) => !r.passed);
if (failed.length > 0) {
  console.log("Failed cases:\n");
  for (const r of failed) {
    console.log(`  [${r.id}] score=${r.score.toFixed(2)}`);
    console.log(`    ${r.finalEval.critique.slice(0, 160)}\n`);
  }
}

process.exit(failed.length > 0 ? 1 : 0);
