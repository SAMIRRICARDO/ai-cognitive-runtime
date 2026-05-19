#!/usr/bin/env tsx
/**
 * run-outbound-batch.ts — Controlled batch execution of VRASHOWS outreach
 *
 * Reads an outreach queue (from generate-outreach-queue.ts), shows per-lead
 * email previews, then executes sends in priority order with rate limiting.
 *
 * Safety first:
 *   - Always dry-run unless --live is explicitly passed
 *   - HOT leads sent first, then WARM
 *   - --limit caps total sends per session
 *   - BCC auto-applied (via env)
 *   - Quality gate: skip entries below --min-quality (default 60)
 *   - Full delivery report saved after every run
 *
 * Usage:
 *   tsx scripts/run-outbound-batch.ts --queue data/outreach/outbound-2026-05-19.json --dry-run
 *   tsx scripts/run-outbound-batch.ts --queue data/outreach/outbound-2026-05-19.json --live --limit 3
 *   tsx scripts/run-outbound-batch.ts --queue data/outreach/outbound-2026-05-19.json --live --hot-only
 *   tsx scripts/run-outbound-batch.ts --queue data/outreach/outbound-2026-05-19.json --preview-only
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { sendEmail } from "../tools/send-email.js";
import type { OutreachQueue, OutreachQueueEntry } from "../agents/outreach-builder/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const val  = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };

const QUEUE_PATH   = val("--queue");
const LIVE         = flag("--live");
const DRY_RUN      = !LIVE;
const LIMIT        = parseInt(val("--limit") ?? "999", 10);
const HOT_ONLY     = flag("--hot-only");
const PREVIEW_ONLY = flag("--preview-only");
const MIN_QUALITY  = parseInt(val("--min-quality") ?? "60", 10);
const JSON_OUT     = flag("--json");
const RATE_DELAY   = parseInt(val("--rate-delay") ?? "1500", 10);

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  bold:   (s: string) => USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s,
  dim:    (s: string) => USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s,
  green:  (s: string) => USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s,
  yellow: (s: string) => USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s,
  red:    (s: string) => USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s,
  blue:   (s: string) => USE_COLOR ? `\x1b[34m${s}\x1b[0m` : s,
  cyan:   (s: string) => USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s,
};

if (!QUEUE_PATH) {
  console.error("Usage: tsx scripts/run-outbound-batch.ts --queue <path> [--live] [--limit N]");
  process.exit(1);
}

// ─── Load queue ───────────────────────────────────────────────────────────────

const queueRaw = JSON.parse(readFileSync(resolve(ROOT, QUEUE_PATH), "utf8")) as OutreachQueue;

// ─── Filter entries ───────────────────────────────────────────────────────────

let entries = queueRaw.entries.filter(e => e.status === "queued");
if (HOT_ONLY) entries = entries.filter(e => e.priority === "HOT");

// Sort: HOT first, then by outreachPriority desc
entries.sort((a, b) => {
  if (a.priority !== b.priority) return a.priority === "HOT" ? -1 : 1;
  return b.lead.outreachPriority - a.lead.outreachPriority;
});

// Quality gate
const skippedByQuality = entries.filter(e => e.quality.score < MIN_QUALITY);
entries = entries.filter(e => e.quality.score >= MIN_QUALITY);

// Apply limit
const toProcess = entries.slice(0, LIMIT);
const remaining = entries.slice(LIMIT);

// ─── Header ───────────────────────────────────────────────────────────────────

if (!JSON_OUT) {
  const hr = "═".repeat(72);
  console.log(`\n${c.bold("VRASHOWS — Outbound Batch Executor")}`);
  console.log(c.dim(`Queue: ${QUEUE_PATH}`));
  console.log(c.dim(`Campaign: ${queueRaw.campaign} · Event: ${queueRaw.targetEvent}`));
  console.log(hr);
  console.log(`  Mode:          ${DRY_RUN ? c.yellow("DRY-RUN (add --live to send)") : c.red("⚡ LIVE SEND")}`);
  console.log(`  Total queued:  ${queueRaw.totalEntries} (HOT: ${queueRaw.hotCount} · WARM: ${queueRaw.warmCount})`);
  console.log(`  Processing:    ${toProcess.length} this run (limit: ${LIMIT})`);
  if (skippedByQuality.length > 0) console.log(`  Quality skip:  ${skippedByQuality.length} entries below Q:${MIN_QUALITY}`);
  if (remaining.length > 0) console.log(`  Deferred:      ${remaining.length} (over limit)`);
  console.log(`  Rate delay:    ${RATE_DELAY}ms between sends`);
  console.log(hr);
}

// ─── Preview section ──────────────────────────────────────────────────────────

if (!JSON_OUT) {
  console.log(`\n${c.bold("EMAIL PREVIEWS")}\n`);

  for (const entry of toProcess) {
    const qColor =
      entry.quality.decision === "send"   ? c.green  :
      entry.quality.decision === "review" ? c.yellow : c.red;
    const prioColor = entry.priority === "HOT" ? c.green : c.yellow;

    console.log(`  ${prioColor(`[${entry.priority}]`)} ${c.bold(entry.lead.contactName)}`);
    console.log(`  ${c.dim("Company:")}    ${entry.lead.company} · ${entry.lead.role}`);
    console.log(`  ${c.dim("To:")}         ${entry.email.to}`);
    console.log(`  ${c.dim("Subject:")}    ${entry.email.subject}`);
    console.log(`  ${c.dim("Quality:")}    ${qColor(`${entry.quality.score}/100 (${entry.quality.decision})`)}`);
    console.log(`  ${c.dim("Priority:")}   ${entry.lead.outreachPriority}/100`);
    console.log(`  ${c.dim("Approach:")}   ${entry.lead.recommendedApproach.slice(0, 90)}${entry.lead.recommendedApproach.length > 90 ? "…" : ""}`);

    // Show first 3 lines of body text
    const bodyPreview = entry.email.bodyText
      .split("\n")
      .filter(l => l.trim())
      .slice(0, 3)
      .join(" · ");
    console.log(`  ${c.dim("Preview:")}    ${c.dim(bodyPreview.slice(0, 100))}${bodyPreview.length > 100 ? "…" : ""}`);
    console.log();
  }
}

if (PREVIEW_ONLY) {
  if (!JSON_OUT) console.log(`${c.cyan("Preview-only mode — no emails sent.")}\n`);
  process.exit(0);
}

// ─── Execution ────────────────────────────────────────────────────────────────

if (!JSON_OUT) {
  const hr = "─".repeat(72);
  console.log(hr);
  console.log(`\n${c.bold("SENDING")}\n`);
}

const sessionStart = new Date().toISOString();
const results: Array<{
  entry: OutreachQueueEntry;
  status: string;
  resendId?: string;
  elapsed: number;
  error?: string;
}> = [];

let sent = 0;
let failed = 0;
let totalTokens = 0;

for (const entry of toProcess) {
  const startMs = Date.now();

  try {
    const record = await sendEmail(
      {
        company: entry.lead.company,
        contactName: entry.lead.contactName,
        recipientEmail: entry.email.to,
        subject: entry.email.subject,
        bodyText: entry.email.bodyText,
        bodyHtml: entry.email.bodyHtml,
        emailType: "cold-outreach",
        sequenceNumber: 1,
        ...(entry.email.attachmentPath ? { attachmentPath: entry.email.attachmentPath } : {}),
      },
      { dryRun: DRY_RUN, rateDelayMs: RATE_DELAY }
    );

    const elapsed = Date.now() - startMs;
    const ok = record.status === "sent" || record.status === "queued";
    if (ok) sent++; else failed++;

    results.push({
      entry: { ...entry, status: record.status, resendId: record.resendId, sentAt: record.sentAt },
      status: record.status,
      resendId: record.resendId,
      elapsed,
      error: record.error,
    });

    if (!JSON_OUT) {
      const statusColor = ok ? c.green : c.red;
      const statusLabel = record.status.toUpperCase().padEnd(8);
      const prioLabel = entry.priority === "HOT" ? c.green("[HOT]") : c.yellow("[WARM]");
      console.log(
        `  ${statusColor(statusLabel)} ${prioLabel} ${c.bold(entry.lead.contactName.padEnd(22))} ` +
        `→ ${entry.email.to}`
      );
      if (record.resendId) console.log(`           ${c.dim(`Resend ID: ${record.resendId}  (${elapsed}ms)`)}`);
      if (record.error)    console.log(`           ${c.red(`Error: ${record.error}`)}`);
    }

  } catch (err) {
    const elapsed = Date.now() - startMs;
    const message = err instanceof Error ? err.message : String(err);
    failed++;
    results.push({ entry, status: "failed", elapsed, error: message });
    if (!JSON_OUT) {
      console.log(`  ${c.red("FAILED  ")} ${c.bold(entry.lead.contactName)} → ${entry.email.to}`);
      console.log(`           ${c.red(`Error: ${message}`)}`);
    }
  }
}

// ─── Delivery report ──────────────────────────────────────────────────────────

const sessionEnd = new Date().toISOString();

const deliveryReport = {
  sessionId:         `session-${sessionStart.replace(/[:.]/g, "-")}`,
  queueId:           queueRaw.queueId,
  campaign:          queueRaw.campaign,
  targetEvent:       queueRaw.targetEvent,
  mode:              DRY_RUN ? "dry-run" : "live",
  sessionStartedAt:  sessionStart,
  sessionCompletedAt: sessionEnd,
  totalAttempted:    toProcess.length,
  sent,
  failed,
  skippedByQuality:  skippedByQuality.length,
  deferred:          remaining.length,
  results: results.map(r => ({
    id:          r.entry.id,
    priority:    r.entry.priority,
    company:     r.entry.lead.company,
    contactName: r.entry.lead.contactName,
    email:       r.entry.email.to,
    subject:     r.entry.email.subject,
    status:      r.status,
    qualityScore: r.entry.quality.score,
    outreachPriority: r.entry.lead.outreachPriority,
    resendId:    r.resendId ?? null,
    elapsed:     r.elapsed,
    error:       r.error ?? null,
    sentAt:      r.entry.sentAt ?? null,
  })),
};

const logDir = resolve(ROOT, "logs/outreach");
mkdirSync(logDir, { recursive: true });
const reportFile = resolve(logDir, `delivery-${deliveryReport.sessionId}.json`);
writeFileSync(reportFile, JSON.stringify(deliveryReport, null, 2), "utf8");

// ─── Final summary ────────────────────────────────────────────────────────────

if (JSON_OUT) {
  process.stdout.write(JSON.stringify(deliveryReport, null, 2) + "\n");
  process.exit(0);
}

const hr2 = "═".repeat(72);
console.log(`\n${hr2}`);
console.log(`  ${c.bold("SESSION COMPLETE")}  [${DRY_RUN ? c.yellow("DRY-RUN") : c.green("LIVE")}]`);
console.log(`  Sent:     ${c.green(String(sent).padStart(3))}`);
console.log(`  Failed:   ${c.red(String(failed).padStart(3))}`);
console.log(`  Deferred: ${String(remaining.length).padStart(3)}`);
console.log(`  Report:   ${reportFile}`);
console.log(hr2);
console.log();

if (remaining.length > 0 && !JSON_OUT) {
  console.log(`  ${c.cyan("→")} ${remaining.length} leads deferred — re-run with same queue to continue.\n`);
}
