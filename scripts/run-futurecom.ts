#!/usr/bin/env tsx
/**
 * Futurecom Researcher — dedicated CLI script with structured output.
 *
 * Usage:
 *   tsx scripts/run-futurecom.ts
 *   tsx scripts/run-futurecom.ts --segments telecom,cloud,ai
 *   tsx scripts/run-futurecom.ts --min-score 60 --max-leads 10
 *   tsx scripts/run-futurecom.ts --json   # output raw JSON
 *
 * Produces:
 *   - Per-lead table with score, segment, booth complexity, budget potential
 *   - High-priority leads summary
 *   - Full JSON dump (with --json flag)
 */
import { FuturecomResearcherAgent } from "../agents/futurecom-researcher/agent.js";
import type { LeadSegment } from "../agents/futurecom-researcher/types.js";
import type { AgentStep } from "../agents/_base/types.js";

// ─── Parse CLI args ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

const minScore   = parseInt(flag("--min-score") ?? "40", 10);
const maxLeads   = parseInt(flag("--max-leads") ?? "20", 10);
const jsonOutput = hasFlag("--json");
const rawSegs    = flag("--segments");
const segments   = rawSegs
  ? (rawSegs.split(",").map((s) => s.trim()) as LeadSegment[])
  : undefined;

// ─── Streaming step handler ───────────────────────────────────────────────────

const onStep = (step: AgentStep) => {
  if (jsonOutput) return; // silent in JSON mode

  if (step.type === "thinking") {
    process.stdout.write(`\x1b[2m${step.content}\x1b[0m\n`);
  } else if (step.type === "tool_call") {
    if (step.tool === "save_lead") {
      const input = step.input as Record<string, unknown>;
      process.stdout.write(
        `\x1b[32m[lead]\x1b[0m ${input.company} · score=${input.initialScore} · ${input.segment}\n`
      );
    } else {
      process.stdout.write(`\x1b[33m[tool]\x1b[0m ${step.tool}\n`);
    }
  }
};

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log("\nFuturecom 2026 — Lead Intelligence by VRASHOWS\n");

const agent = await FuturecomResearcherAgent.create();

const result = await agent.research(
  "Identify companies exhibiting or sponsoring Futurecom 2026 with high potential for 360° event operations partnership with VRASHOWS",
  { minScore, maxLeads, segments },
  { onStep }
);

if (jsonOutput) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(0);
}

// ─── Human-readable output ────────────────────────────────────────────────────

console.log("\n" + "─".repeat(80));
console.log(`  RESEARCH COMPLETE — ${result.totalLeads} leads found (${result.highPriorityCount} high-priority)`);
console.log("─".repeat(80) + "\n");

if (result.leads.length === 0) {
  console.log("No leads met the minimum score threshold.\n");
  process.exit(0);
}

// Lead table
const col = (s: string, w: number) => s.slice(0, w).padEnd(w);

console.log(
  col("SCORE", 6) +
  col("COMPANY", 30) +
  col("SEGMENT", 20) +
  col("BUDGET", 12) +
  col("RELEVANCE", 12) +
  "BOOTH"
);
console.log("─".repeat(80));

for (const lead of result.leads) {
  const score = String(lead.initialScore).padStart(3);
  const line =
    `  ${score}  ` +
    col(lead.company, 30) +
    col(lead.segment, 20) +
    col(lead.budgetPotential, 12) +
    col(lead.eventRelevance, 12) +
    lead.boothComplexity;
  const color = lead.initialScore >= 70 ? "\x1b[32m" : lead.initialScore >= 50 ? "\x1b[33m" : "";
  console.log(`${color}${line}\x1b[0m`);
}

console.log("\n" + "─".repeat(80));

// Strategic notes for top 5
console.log("\nTOP LEADS — STRATEGIC NOTES\n");
for (const lead of result.leads.slice(0, 5)) {
  console.log(`\x1b[1m${lead.company}\x1b[0m (score: ${lead.initialScore})`);
  console.log(`  ${lead.strategicNotes}`);
  if (lead.website !== "unknown") console.log(`  Website:  ${lead.website}`);
  if (lead.linkedin !== "unknown") console.log(`  LinkedIn: ${lead.linkedin}`);
  console.log();
}

console.log(`Session: ${result.sessionStartedAt} → ${result.sessionCompletedAt}`);
