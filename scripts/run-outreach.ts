#!/usr/bin/env tsx
/**
 * Outreach CLI — generates VRASHOWS enterprise outreach from lead profiles.
 *
 * Modes:
 *   1. Pipeline (default): research → outreach in one command
 *   2. Outreach-only: reads leads from a JSON file
 *
 * Usage:
 *   tsx scripts/run-outreach.ts
 *   tsx scripts/run-outreach.ts --from-file leads.json
 *   tsx scripts/run-outreach.ts --channel email --tone direct --min-score 60
 *   tsx scripts/run-outreach.ts --json > outreach.json
 *
 * Options:
 *   --from-file <path>   Load leads from a JSON file (skips research phase)
 *   --channel            email | linkedin | both (default: both)
 *   --tone               consultive | direct | referral (default: consultive)
 *   --min-score          Minimum lead score to process (default: 40)
 *   --max-leads          Max leads from research phase (default: 10)
 *   --json               Output raw JSON to stdout
 */
import { readFile } from "fs/promises";
import { FuturecomResearcherAgent } from "../agents/futurecom-researcher/agent.js";
import { OutreachAgent } from "../agents/outreach-agent/agent.js";
import type { LeadProfile } from "../agents/futurecom-researcher/types.js";
import type { OutreachChannel, OutreachTone } from "../agents/outreach-agent/types.js";
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

const fromFile   = flag("--from-file");
const channel    = (flag("--channel") ?? "both") as OutreachChannel;
const tone       = (flag("--tone") ?? "consultive") as OutreachTone;
const minScore   = parseInt(flag("--min-score") ?? "40", 10);
const maxLeads   = parseInt(flag("--max-leads") ?? "10", 10);
const jsonOutput = hasFlag("--json");

// ─── Step handler ─────────────────────────────────────────────────────────────

function makeStepHandler(label: string) {
  return (step: AgentStep) => {
    if (jsonOutput) return;
    if (step.type === "thinking") {
      process.stderr.write(`\x1b[2m[${label}] ${step.content}\x1b[0m\n`);
    } else if (step.type === "tool_call") {
      const name = step.tool;
      const inp  = step.input as Record<string, unknown>;
      if (name === "save_outreach") {
        process.stderr.write(`\x1b[32m[outreach]\x1b[0m ${inp.company}\n`);
      } else if (name === "web_search") {
        process.stderr.write(`\x1b[33m[search]\x1b[0m ${(inp.query as string)?.slice(0, 70)}\n`);
      } else if (name === "save_lead") {
        process.stderr.write(`\x1b[34m[lead]\x1b[0m ${inp.company} score=${inp.initialScore}\n`);
      }
    }
  };
}

// ─── Phase 1: acquire leads ───────────────────────────────────────────────────

let leads: LeadProfile[] = [];

if (fromFile) {
  if (!jsonOutput) console.log(`\nLoading leads from ${fromFile}…`);
  const raw = JSON.parse(await readFile(fromFile, "utf8"));
  leads = Array.isArray(raw) ? raw : (raw.leads ?? []);
  if (!jsonOutput) console.log(`Loaded ${leads.length} leads.\n`);
} else {
  if (!jsonOutput) {
    console.log("\nVRASHOWS Outreach Pipeline");
    console.log("Phase 1/2 — Researching Futurecom leads…\n");
  }

  const researcher = await FuturecomResearcherAgent.create();
  const research   = await researcher.research(
    "Identify companies exhibiting or sponsoring Futurecom 2026 with high potential for 360° event operations partnership",
    { minScore, maxLeads },
    { onStep: makeStepHandler("research") }
  );

  leads = research.leads;

  if (!jsonOutput) {
    console.log(`\nResearch complete — ${leads.length} leads found.\n`);
  }
}

if (leads.length === 0) {
  if (!jsonOutput) console.log("No leads to process. Exiting.\n");
  process.exit(0);
}

// ─── Phase 2: generate outreach ───────────────────────────────────────────────

if (!jsonOutput) {
  console.log(`Phase 2/2 — Generating outreach for ${leads.length} leads…\n`);
}

const outreachAgent = await OutreachAgent.create();
const result        = await outreachAgent.generate(
  leads,
  { channel, tone, minScore, event: "Futurecom 2026" },
  { onStep: makeStepHandler("outreach") }
);

// ─── Output ───────────────────────────────────────────────────────────────────

if (jsonOutput) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(0);
}

const hr = "─".repeat(80);

console.log(`\n${hr}`);
console.log(`  OUTREACH COMPLETE — ${result.packages.length} packages generated`);
if (result.failures.length > 0) {
  console.log(`  Failed: ${result.failures.map((f) => f.company).join(", ")}`);
}
console.log(`${hr}\n`);

for (const pkg of result.packages) {
  const scoreColor = pkg.leadScore >= 70 ? "\x1b[32m" : pkg.leadScore >= 50 ? "\x1b[33m" : "\x1b[0m";

  console.log(`${scoreColor}▶ ${pkg.company}\x1b[0m  (score: ${pkg.leadScore})`);
  console.log(`  ${hr.slice(0, 76)}`);

  if (channel !== "linkedin") {
    console.log(`\n  \x1b[1mEMAIL\x1b[0m`);
    console.log(`  Subject: ${pkg.coldEmail.subject}`);
    console.log(`\n${pkg.coldEmail.body.split("\n").map((l) => `  ${l}`).join("\n")}`);
    console.log(`\n  CTA: ${pkg.coldEmail.cta}`);
  }

  if (channel !== "email") {
    console.log(`\n  \x1b[1mLINKEDIN\x1b[0m`);
    console.log(`${pkg.linkedinMessage.body.split("\n").map((l) => `  ${l}`).join("\n")}`);
    console.log(`\n  Connect note: ${pkg.linkedinMessage.connectionNote}`);
  }

  console.log(`\n  \x1b[1mSTRATEGIC POSITIONING\x1b[0m`);
  console.log(`  ${pkg.strategicPositioning}`);

  console.log(`\n  \x1b[2mPersonalization: ${pkg.personalizationNotes}\x1b[0m`);
  console.log();
}

console.log(`Session: ${result.sessionStartedAt} → ${result.sessionCompletedAt}`);
