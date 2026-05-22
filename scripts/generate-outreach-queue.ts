#!/usr/bin/env tsx
/**
 * generate-outreach-queue.ts — Builds personalized outreach queue from validated leads
 *
 * Reads one or more validated lead JSON files, filters HOT + WARM leads,
 * generates personalized email content per lead, scores quality, and
 * writes an outreach queue ready for run-outbound-batch.ts.
 *
 * Usage:
 *   tsx scripts/generate-outreach-queue.ts
 *   tsx scripts/generate-outreach-queue.ts --input data/leads/telecom-leads.json
 *   tsx scripts/generate-outreach-queue.ts --all           # process all lead files
 *   tsx scripts/generate-outreach-queue.ts --hot-only      # exclude WARM
 *   tsx scripts/generate-outreach-queue.ts --json          # JSON to stdout
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { resolve, dirname, basename, join } from "path";
import { fileURLToPath } from "url";
import { scoreLeads } from "../agents/lead-validation/scorer.js";
import { buildPersonalizedEmail } from "../agents/outreach-builder/builder.js";
import type { RawLeadFile, ValidatedLead } from "../agents/lead-validation/types.js";
import type { OutreachQueue, OutreachQueueEntry } from "../agents/outreach-builder/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const val  = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };

const INPUT_PATH   = val("--input");
const ALL_FILES    = flag("--all");
const HOT_ONLY     = flag("--hot-only");
const JSON_OUT     = flag("--json");
const ATTACH_PATH  = val("--attach") ?? process.env.MEDIA_KIT_PDF ?? undefined;

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  bold:   (s: string) => USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s,
  dim:    (s: string) => USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s,
  green:  (s: string) => USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s,
  yellow: (s: string) => USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s,
  red:    (s: string) => USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s,
  cyan:   (s: string) => USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s,
};

// ─── Collect input files ──────────────────────────────────────────────────────

function collectInputFiles(): string[] {
  if (INPUT_PATH) return [resolve(ROOT, INPUT_PATH)];
  if (ALL_FILES) {
    const leadsDir = resolve(ROOT, "data/leads");
    return readdirSync(leadsDir)
      .filter(f => f.endsWith(".json") && !f.includes("validated"))
      .map(f => join(leadsDir, f));
  }
  // Default: all non-validated JSON files in data/leads
  const leadsDir = resolve(ROOT, "data/leads");
  return readdirSync(leadsDir)
    .filter(f => f.endsWith(".json") && !f.includes("validated"))
    .map(f => join(leadsDir, f));
}

// ─── Load and validate leads ──────────────────────────────────────────────────

function loadValidatedLeads(filePath: string): ValidatedLead[] {
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as RawLeadFile;
  return scoreLeads(raw.leads, raw.campaign, raw.targetEvent);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const inputFiles = collectInputFiles();

if (!JSON_OUT) {
  console.log(`\n${c.bold("VRASHOWS — Outreach Queue Generator")}`);
  console.log(c.dim(`Processing ${inputFiles.length} lead file(s)…`));
  console.log("─".repeat(72));
}

const allValidated: ValidatedLead[] = [];

for (const filePath of inputFiles) {
  try {
    const validated = loadValidatedLeads(filePath);
    const fileName = basename(filePath);
    if (!JSON_OUT) {
      const hot  = validated.filter(l => l.status === "HOT").length;
      const warm = validated.filter(l => l.status === "WARM").length;
      console.log(`  ${c.dim(fileName)}: ${validated.length} leads — ${c.green(`HOT ${hot}`)} · ${c.yellow(`WARM ${warm}`)}`);
    }
    allValidated.push(...validated);
  } catch (err) {
    if (!JSON_OUT) console.error(`  ${c.red("✗")} Failed to load ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Filter to actionable leads
const actionable = allValidated.filter(l =>
  l.status === "HOT" || (!HOT_ONLY && l.status === "WARM")
);

if (!JSON_OUT) {
  const hot  = actionable.filter(l => l.status === "HOT").length;
  const warm = actionable.filter(l => l.status === "WARM").length;
  console.log(`\n  Total actionable: ${actionable.length} (${c.green(`HOT ${hot}`)} · ${c.yellow(`WARM ${warm}`)})\n`);
}

// ─── Build queue entries ──────────────────────────────────────────────────────

const entries: OutreachQueueEntry[] = [];
let totalQuality = 0;

for (const lead of actionable) {
  const { subject, bodyText, bodyHtml, firstName, quality } = buildPersonalizedEmail(lead);
  totalQuality += quality.score;

  const entry: OutreachQueueEntry = {
    id: `${lead.company.toLowerCase().replace(/\s+/g, "-")}-${lead.primaryEmail.split("@")[0]}`,
    priority: lead.status as "HOT" | "WARM",
    lead,
    email: {
      to: lead.primaryEmail,
      subject,
      bodyText,
      bodyHtml,
      ...(ATTACH_PATH ? { attachmentPath: ATTACH_PATH } : {}),
    },
    quality,
    status: "queued",
  };

  entries.push(entry);

  if (!JSON_OUT) {
    const qColor =
      quality.decision === "send"   ? c.green  :
      quality.decision === "review" ? c.yellow :
      c.red;
    const statusLabel = lead.status === "HOT" ? c.green("HOT ") : c.yellow("WARM");

    console.log(
      `  [${statusLabel}] ${c.bold(lead.contactName.padEnd(22))} ` +
      `${c.dim(`${lead.company.padEnd(10)} ·`)} ` +
      `${qColor(`Q:${quality.score}/100`)} · ` +
      `${c.dim(`${lead.primaryEmail}`)}`
    );
    if (quality.issues.length > 0) {
      for (const issue of quality.issues) console.log(`         ${c.yellow("⚠")} ${c.dim(issue)}`);
    }
  }
}

// ─── Build queue object ───────────────────────────────────────────────────────

const campaigns = [...new Set(allValidated.map(l => l.campaignId))].join(", ");
const targetEvents = [...new Set(allValidated.map(l => l.targetEvent))].join(", ");
const avgQuality = entries.length > 0 ? Math.round(totalQuality / entries.length) : 0;

const queue: OutreachQueue = {
  queueId: `outbound-${new Date().toISOString().split("T")[0]}`,
  generatedAt: new Date().toISOString(),
  campaign: campaigns,
  targetEvent: targetEvents,
  attachmentPath: ATTACH_PATH ?? "",
  totalEntries: entries.length,
  hotCount: entries.filter(e => e.priority === "HOT").length,
  warmCount: entries.filter(e => e.priority === "WARM").length,
  avgQualityScore: avgQuality,
  entries,
};

// ─── Save ─────────────────────────────────────────────────────────────────────

const outDir = resolve(ROOT, "data/outreach");
mkdirSync(outDir, { recursive: true });
const queueFile = resolve(outDir, `${queue.queueId}.json`);
writeFileSync(queueFile, JSON.stringify(queue, null, 2), "utf8");

// Also save validated leads for both campaigns
const validatedDir = resolve(ROOT, "data/leads/validated");
mkdirSync(validatedDir, { recursive: true });

for (const filePath of inputFiles) {
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as RawLeadFile;
    const validated = scoreLeads(raw.leads, raw.campaign, raw.targetEvent);
    const baseName = basename(filePath, ".json");
    const outFile = resolve(validatedDir, `${baseName}-validated.json`);
    writeFileSync(outFile, JSON.stringify({ ...raw, leads: validated, validatedAt: new Date().toISOString() }, null, 2), "utf8");
  } catch { /* already errored above */ }
}

// ─── Output ───────────────────────────────────────────────────────────────────

if (JSON_OUT) {
  process.stdout.write(JSON.stringify(queue, null, 2) + "\n");
  process.exit(0);
}

console.log(`\n${"─".repeat(72)}`);
console.log(`  ${c.bold("QUEUE SUMMARY")}`);
console.log(`  HOT leads:    ${c.green(String(queue.hotCount).padStart(3))}`);
console.log(`  WARM leads:   ${c.yellow(String(queue.warmCount).padStart(3))}`);
console.log(`  Total:        ${String(queue.totalEntries).padStart(3)}`);
console.log(`  Avg quality:  ${String(queue.avgQualityScore).padStart(3)}/100`);
console.log(`\n  ${c.green("✓")} Queue saved: ${queueFile}`);
console.log(`\n  Next step: ${c.cyan("tsx scripts/run-outbound-batch.ts --queue " + queueFile + " --dry-run")}\n`);
