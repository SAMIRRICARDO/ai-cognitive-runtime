#!/usr/bin/env tsx
/**
 * validate-leads.ts — VRASHOWS Lead Validation Pipeline
 *
 * Reads raw lead files, applies strategic scoring, and produces
 * a validated output with HOT/WARM/LOW_PRIORITY/INVALID classification,
 * outreach recommendations, and bounce risk assessment.
 *
 * Usage:
 *   tsx scripts/validate-leads.ts                              # validate aws-leads.json
 *   tsx scripts/validate-leads.ts --input data/leads/aws-leads.json
 *   tsx scripts/validate-leads.ts --json                       # JSON to stdout
 *   tsx scripts/validate-leads.ts --csv                        # CSV export
 *   tsx scripts/validate-leads.ts --status HOT                 # filter by status
 *   tsx scripts/validate-leads.ts --min-priority 70            # filter by priority
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { scoreLeads } from "../agents/lead-validation/scorer.js";
import type {
  RawLeadFile,
  ValidatedLead,
  ValidationResult,
  LeadStatus,
} from "../agents/lead-validation/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag  = (f: string) => args.includes(f);
const val   = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };

const INPUT_PATH    = val("--input") ?? "data/leads/aws-leads.json";
const JSON_OUTPUT   = flag("--json");
const CSV_OUTPUT    = flag("--csv");
const STATUS_FILTER = val("--status") as LeadStatus | undefined;
const MIN_PRIORITY  = parseInt(val("--min-priority") ?? "0", 10);
const NO_SAVE       = flag("--no-save");

// ─── Colors ───────────────────────────────────────────────────────────────────

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  bold:  (s: string) => USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s,
  dim:   (s: string) => USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s,
  green: (s: string) => USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s,
  yellow:(s: string) => USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s,
  red:   (s: string) => USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s,
  blue:  (s: string) => USE_COLOR ? `\x1b[34m${s}\x1b[0m` : s,
  cyan:  (s: string) => USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s,
};

function statusColor(status: LeadStatus): (s: string) => string {
  return status === "HOT"          ? c.green  :
         status === "WARM"         ? c.yellow :
         status === "LOW_PRIORITY" ? c.dim    :
         c.red;
}

function bounceColor(risk: string): (s: string) => string {
  return risk === "low" ? c.green : risk === "medium" ? c.yellow : c.red;
}

// ─── Load input ───────────────────────────────────────────────────────────────

const absoluteInput = resolve(ROOT, INPUT_PATH);
let rawFile: RawLeadFile;
try {
  rawFile = JSON.parse(readFileSync(absoluteInput, "utf8")) as RawLeadFile;
} catch (err) {
  console.error(`Failed to read input file: ${absoluteInput}`);
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// ─── Run scorer ───────────────────────────────────────────────────────────────

const validated = scoreLeads(rawFile.leads, rawFile.campaign, rawFile.targetEvent);

// ─── Apply filters ────────────────────────────────────────────────────────────

let filtered = validated;
if (STATUS_FILTER) filtered = filtered.filter(l => l.status === STATUS_FILTER);
if (MIN_PRIORITY > 0) filtered = filtered.filter(l => l.outreachPriority >= MIN_PRIORITY);

// ─── Build result ─────────────────────────────────────────────────────────────

const result: ValidationResult = {
  campaignId:  rawFile.campaign,
  targetEvent: rawFile.targetEvent,
  totalLeads:  validated.length,
  hot:         validated.filter(l => l.status === "HOT").length,
  warm:        validated.filter(l => l.status === "WARM").length,
  lowPriority: validated.filter(l => l.status === "LOW_PRIORITY").length,
  invalid:     validated.filter(l => l.status === "INVALID").length,
  leads:       validated,
  validatedAt: new Date().toISOString(),
};

// ─── Save outputs ─────────────────────────────────────────────────────────────

if (!NO_SAVE) {
  const outDir = resolve(ROOT, "data/leads/validated");
  mkdirSync(outDir, { recursive: true });

  const inputBasename = basename(absoluteInput, ".json");
  const jsonOut = resolve(outDir, `${inputBasename}-validated.json`);
  writeFileSync(jsonOut, JSON.stringify(result, null, 2), "utf8");

  if (CSV_OUTPUT || !JSON_OUTPUT) {
    const csvHeaders = [
      "status","outreachPriority","relevanceScore","bounceRisk",
      "company","contactName","role","seniority","area",
      "primaryEmail","confidence","strategicFit",
      "recommendedTemplate","useCaseABRINT","personalizationLevel",
    ].join(",");

    const csvRows = validated.map(l => [
      l.status,
      l.outreachPriority,
      l.relevanceScore,
      l.bounceRisk,
      `"${l.company}"`,
      `"${l.contactName}"`,
      `"${l.role}"`,
      l.seniority,
      l.area,
      l.primaryEmail,
      l.confidence,
      l.strategicFit,
      l.recommendedTemplate,
      l.useCaseABRINT,
      l.personalizationLevel,
    ].join(","));

    const csvOut = resolve(outDir, `${inputBasename}-validated.csv`);
    writeFileSync(csvOut, [csvHeaders, ...csvRows].join("\n"), "utf8");
  }
}

// ─── Output modes ─────────────────────────────────────────────────────────────

if (JSON_OUTPUT) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(0);
}

// ─── Human-readable report ────────────────────────────────────────────────────

const hr  = "─".repeat(80);
const hr2 = "═".repeat(80);

console.log(`\n${c.bold("VRASHOWS — Lead Validation Report")}`);
console.log(c.dim(`Campaign: ${rawFile.campaign} · Event: ${rawFile.targetEvent}`));
console.log(hr2);

// Summary
console.log(`\n  ${c.bold("CLASSIFICATION SUMMARY")}`);
console.log(`  ${c.green("● HOT")}          ${result.hot}  leads — send immediately`);
console.log(`  ${c.yellow("● WARM")}         ${result.warm}  leads — queue for next batch`);
console.log(`  ${c.dim("● LOW PRIORITY")} ${result.lowPriority}  leads — deprioritize`);
console.log(`  ${c.red("● INVALID")}      ${result.invalid}  leads — skip\n`);
console.log(hr);

// Per-lead details
for (const lead of filtered) {
  const statusFn = statusColor(lead.status);
  const bounceFn = bounceColor(lead.bounceRisk);

  console.log(`\n  ${statusFn(lead.status.padEnd(12))} ${c.bold(lead.contactName)} — ${lead.role}`);
  console.log(`  ${c.dim("Company:")}         ${lead.company}`);
  console.log(`  ${c.dim("Area/Seniority:")}  ${lead.area} · ${lead.seniority}`);
  console.log(`  ${c.dim("Primary email:")}   ${lead.primaryEmail}`);
  console.log(`  ${c.dim("Confidence:")}      ${lead.confidence}  |  Bounce risk: ${bounceFn(lead.bounceRisk)}`);
  console.log();
  console.log(`  ${c.cyan("SCORES")}`);
  console.log(`  Relevance:      ${String(lead.relevanceScore).padStart(3)}/100`);
  console.log(`  Strategic fit:  ${String(lead.strategicFitScore).padStart(3)}/100  (${lead.strategicFit})`);
  console.log(`  Outreach prio:  ${String(lead.outreachPriority).padStart(3)}/100`);
  console.log();
  console.log(`  ${c.cyan("OUTREACH RECOMMENDATION")}`);
  console.log(`  Template:       ${lead.recommendedTemplate}`);
  console.log(`  Personalization:${lead.personalizationLevel}`);
  console.log(`  ABRINT case:    ${lead.useCaseABRINT ? "Yes — include" : "No — omit"}`);
  console.log(`  Approach:       ${lead.recommendedApproach}`);
  console.log(`  CTA:            ${lead.recommendedCTA}`);
  console.log();
  console.log(`  ${c.dim("Rationale:")} ${lead.rationale}`);
  console.log(hr);
}

// Save confirmation
if (!NO_SAVE) {
  const outDir = resolve(ROOT, "data/leads/validated");
  const inputBasename = basename(absoluteInput, ".json");
  console.log(`\n${c.green("✓")} Saved: ${outDir}/${inputBasename}-validated.json`);
  if (CSV_OUTPUT || !JSON_OUTPUT) {
    console.log(`${c.green("✓")} Saved: ${outDir}/${inputBasename}-validated.csv`);
  }
}

console.log(`\n${c.dim(`Validated at: ${result.validatedAt}`)}\n`);
