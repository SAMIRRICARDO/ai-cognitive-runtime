#!/usr/bin/env tsx
/**
 * Lead Enrichment CLI — enriches enterprise companies with decision maker contacts.
 *
 * Modes:
 *   1. Direct (default): enrich the 5 priority companies for VRASHOWS
 *   2. Pipeline:         research Futurecom leads → enrich discovered companies
 *   3. From file:        read leads from a JSON file (output of run-futurecom.ts --json)
 *   4. Custom companies: pass company names via --companies flag
 *
 * Usage:
 *   tsx scripts/run-enrichment.ts
 *   tsx scripts/run-enrichment.ts --pipeline
 *   tsx scripts/run-enrichment.ts --from-file leads.json
 *   tsx scripts/run-enrichment.ts --companies "AWS,Claro,Vivo"
 *   tsx scripts/run-enrichment.ts --min-seniority director --max-per-company 3
 *   tsx scripts/run-enrichment.ts --json > enriched.json
 *
 * Options:
 *   --pipeline             Research Futurecom leads first, then enrich
 *   --from-file <path>     Load leads from a JSON file (skips research phase)
 *   --companies <list>     Comma-separated company names to enrich
 *   --min-seniority        c-level | director | manager | analyst (default: manager)
 *   --max-per-company      Max contacts per company (default: 5)
 *   --min-score            Min lead score when in pipeline mode (default: 40)
 *   --max-leads            Max leads from research phase in pipeline mode (default: 15)
 *   --json                 Output raw JSON to stdout
 */

import { readFile } from "fs/promises";
import { LeadEnrichmentAgent } from "../agents/lead-enrichment-agent/agent.js";
import { FuturecomResearcherAgent } from "../agents/futurecom-researcher/agent.js";
import type { LeadProfile } from "../agents/futurecom-researcher/types.js";
import type { ContactSeniority } from "../agents/lead-enrichment-agent/types.js";
import type { AgentStep } from "../agents/_base/types.js";

// ─── Default priority companies for VRASHOWS ─────────────────────────────────

const DEFAULT_COMPANIES = ["AWS", "Claro", "Vivo", "Microsoft", "Huawei"];

// ─── Parse CLI args ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

const pipelineMode  = hasFlag("--pipeline");
const fromFile      = flag("--from-file");
const rawCompanies  = flag("--companies");
const minSeniority  = (flag("--min-seniority") ?? "manager") as ContactSeniority;
const maxPerCompany = parseInt(flag("--max-per-company") ?? "5", 10);
const minScore      = parseInt(flag("--min-score") ?? "40", 10);
const maxLeads      = parseInt(flag("--max-leads") ?? "15", 10);
const jsonOutput    = hasFlag("--json");

// ─── Step handler ─────────────────────────────────────────────────────────────

function makeStepHandler(label: string) {
  return (step: AgentStep) => {
    if (jsonOutput) return;
    if (step.type === "thinking") {
      process.stderr.write(`\x1b[2m[${label}] ${step.content}\x1b[0m\n`);
    } else if (step.type === "tool_call") {
      const inp = step.input as Record<string, unknown>;
      if (step.tool === "save_contact") {
        const priority = inp.priority as string;
        const color =
          priority === "high" ? "\x1b[32m" :
          priority === "medium" ? "\x1b[33m" :
          "\x1b[0m";
        process.stderr.write(
          `${color}[contact]\x1b[0m ${inp.company} — ${inp.name} (${inp.role}) [${priority}]\n`
        );
      } else if (step.tool === "web_search") {
        process.stderr.write(
          `\x1b[34m[search]\x1b[0m ${(inp.query as string)?.slice(0, 80)}\n`
        );
      } else if (step.tool === "save_lead") {
        process.stderr.write(
          `\x1b[36m[lead]\x1b[0m ${inp.company} score=${inp.initialScore}\n`
        );
      }
    }
  };
}

// ─── Phase 1: resolve target companies ───────────────────────────────────────

let companies: string[] = [];
let leadContext: LeadProfile[] = [];

if (fromFile) {
  if (!jsonOutput) console.log(`\nLoading leads from ${fromFile}…`);
  const raw = JSON.parse(await readFile(fromFile, "utf8"));
  const leads: LeadProfile[] = Array.isArray(raw) ? raw : (raw.leads ?? []);
  companies = leads.map((l) => l.company);
  leadContext = leads;
  if (!jsonOutput) console.log(`Loaded ${companies.length} companies from file.\n`);

} else if (pipelineMode) {
  if (!jsonOutput) {
    console.log("\nVRASHOWS Lead Intelligence Pipeline");
    console.log("Phase 1/2 — Researching Futurecom 2026 leads…\n");
  }

  const researcher = await FuturecomResearcherAgent.create();
  const research = await researcher.research(
    "Identify companies exhibiting or sponsoring Futurecom 2026 with high potential for 360° event operations partnership with VRASHOWS",
    { minScore, maxLeads },
    { onStep: makeStepHandler("research") }
  );

  companies = research.leads.map((l) => l.company);
  leadContext = research.leads;

  if (!jsonOutput) {
    console.log(`\nResearch complete — ${companies.length} companies to enrich.\n`);
  }

} else if (rawCompanies) {
  companies = rawCompanies.split(",").map((c) => c.trim()).filter(Boolean);

} else {
  companies = DEFAULT_COMPANIES;
  if (!jsonOutput) {
    console.log("\nVRASHOWS Lead Enrichment — Priority Companies");
    console.log(`Target: ${companies.join(", ")}\n`);
  }
}

if (companies.length === 0) {
  if (!jsonOutput) console.log("No companies to enrich. Exiting.\n");
  process.exit(0);
}

// ─── Phase 2: enrich ─────────────────────────────────────────────────────────

if (!jsonOutput && pipelineMode) {
  console.log(`Phase 2/2 — Enriching ${companies.length} companies with decision maker contacts…\n`);
} else if (!jsonOutput && !fromFile && !rawCompanies) {
  console.log(`Enriching ${companies.length} companies…\n`);
}

const enrichmentAgent = await LeadEnrichmentAgent.create();
const result = await enrichmentAgent.enrich(
  { companies, leadContext, options: { minSeniority, maxContactsPerCompany: maxPerCompany } },
  { onStep: makeStepHandler("enrichment") }
);

// ─── Output ───────────────────────────────────────────────────────────────────

if (jsonOutput) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(0);
}

const hr = "─".repeat(80);

const highCount = result.contacts.filter((c) => c.priority === "high").length;
const medCount  = result.contacts.filter((c) => c.priority === "medium").length;

console.log(`\n${hr}`);
console.log(`  ENRICHMENT COMPLETE`);
console.log(`  ${result.contacts.length} contacts found across ${result.companiesProcessed} companies`);
console.log(`  High priority: ${highCount}  Medium: ${medCount}  Low: ${result.contacts.length - highCount - medCount}`);
if (result.gaps.length > 0) {
  console.log(`  Coverage gaps: ${result.gaps.join(", ")}`);
}
console.log(`${hr}\n`);

const col = (s: string, w: number) => (s ?? "").slice(0, w).padEnd(w);

// Per-company section
for (const company of result.companies) {
  const coverageColor =
    company.coverageQuality === "strong" ? "\x1b[32m" :
    company.coverageQuality === "partial" ? "\x1b[33m" :
    company.coverageQuality === "weak" ? "\x1b[33m" :
    "\x1b[31m";

  console.log(`${coverageColor}▶ ${company.company}\x1b[0m  (${company.totalContacts} contacts · coverage: ${company.coverageQuality})`);
  console.log(`  ${hr.slice(0, 76)}`);

  if (company.contacts.length === 0) {
    console.log("  \x1b[2mNo contacts found.\x1b[0m\n");
    continue;
  }

  // Column headers
  console.log(
    "  " +
    col("PRIORITY", 10) +
    col("NAME", 28) +
    col("ROLE", 32) +
    "AREA"
  );
  console.log("  " + "─".repeat(76));

  for (const contact of company.contacts) {
    const pcolor =
      contact.priority === "high" ? "\x1b[32m" :
      contact.priority === "medium" ? "\x1b[33m" :
      "\x1b[0m";

    console.log(
      "  " +
      `${pcolor}${col(contact.priority.toUpperCase(), 10)}\x1b[0m` +
      col(contact.name, 28) +
      col(contact.role, 32) +
      contact.area
    );

    if (contact.linkedin !== "unknown") {
      console.log(`    \x1b[2mLinkedIn: ${contact.linkedin}\x1b[0m`);
    }
    if (contact.possibleEmail !== "unknown") {
      const emailLabel = contact.emailInferred
        ? `(inferred, ${contact.emailConfidence} confidence)`
        : "(confirmed)";
      console.log(`    \x1b[2mEmail: ${contact.possibleEmail} ${emailLabel}\x1b[0m`);

      if (contact.guessedEmails && contact.guessedEmails.length > 1) {
        const variants = contact.guessedEmails
          .slice(1, 4)
          .map((g) => `${g.email} [${g.pattern}, ${g.confidence}]`)
          .join(", ");
        console.log(`    \x1b[2mVariants: ${variants}\x1b[0m`);
      }
    }
    console.log(`    \x1b[2m${contact.strategicNotes}\x1b[0m`);
    console.log();
  }
}

// Research summary
if (result.researchSummary) {
  console.log(`${hr}`);
  console.log("\nRESEARCH SUMMARY\n");
  console.log(result.researchSummary.split("\n").map((l) => `  ${l}`).join("\n"));
  console.log();
}

console.log(`Session: ${result.sessionStartedAt} → ${result.sessionCompletedAt}`);
