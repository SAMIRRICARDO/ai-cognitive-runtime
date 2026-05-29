#!/usr/bin/env tsx
/**
 * run-cold-outreach.ts — Generic cold outreach sender for any validated leads file
 *
 * Loads a ValidatedLead file, cross-references outbound logs to skip already-sent
 * contacts, builds premium personalized emails, sends via Resend with rate limiting.
 *
 * Usage:
 *   tsx scripts/run-cold-outreach.ts --source data/leads/futurecom/validated-expansion-batch-01.json
 *   tsx scripts/run-cold-outreach.ts --source data/leads/futurecom/validated-expansion-batch-01.json --live --limit 5
 *   tsx scripts/run-cold-outreach.ts --source data/leads/futurecom/validated-expansion-batch-01.json --preview-only
 *   tsx scripts/run-cold-outreach.ts --all    # loads all uncontacted leads across all sources
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { sendEmail } from "../tools/send-email.js";
import { buildPersonalizedEmail } from "../agents/outreach-builder/builder.js";
import type { ValidatedLead } from "../agents/lead-validation/types.js";
import { env } from "../config/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const LOGS_DIR = resolve(ROOT, "logs");
const OUTREACH_DIR = resolve(LOGS_DIR, "outreach");

// ─── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const val  = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };

const SOURCE    = val("--source");
const ALL_MODE  = flag("--all");
const LIVE      = flag("--live");
const DRY_RUN   = !LIVE;
const PREVIEW_ONLY = flag("--preview-only");
const LIMIT     = parseInt(val("--limit") ?? "999", 10);
const RATE_DELAY = parseInt(val("--rate-delay") ?? (LIVE ? "180000" : "0"), 10);
const HOT_ONLY  = flag("--hot-only");
const ATTACH_PATH = val("--attach") ?? env.MEDIA_KIT_PDF ?? undefined;
const BCC_ADDRESS = env.OUTBOUND_BCC_EMAIL ?? undefined;

const ALL_SOURCES = [
  "data/leads/validated/aws-leads-validated.json",
  "data/leads/validated/telecom-leads-validated.json",
  "data/leads/futurecom/validated-top5.json",
  "data/leads/futurecom/validated-remaining20.json",
  "data/leads/futurecom/validated-expansion-batch-01.json",
];

if (!SOURCE && !ALL_MODE) {
  console.error("Usage: tsx scripts/run-cold-outreach.ts --source <path> [--live] [--limit N]");
  console.error("       tsx scripts/run-cold-outreach.ts --all [--live] [--limit N]");
  process.exit(1);
}

// ─── Load already-sent emails ─────────────────────────────────────────────────

function loadSentEmails(): Set<string> {
  const sent = new Set<string>();

  const outbound = existsSync(resolve(LOGS_DIR, "outbound-log.json"))
    ? JSON.parse(readFileSync(resolve(LOGS_DIR, "outbound-log.json"), "utf8")) as any[]
    : [];
  for (const item of outbound) {
    if (item?.status !== "sent") continue;
    const e = (item.email ?? item.recipientEmail ?? item.to ?? "").trim().toLowerCase();
    if (e) sent.add(e);
  }

  if (existsSync(OUTREACH_DIR)) {
    for (const f of readdirSync(OUTREACH_DIR).filter((f) => f.endsWith(".json"))) {
      const session = JSON.parse(readFileSync(join(OUTREACH_DIR, f), "utf8")) as any;
      for (const item of (Array.isArray(session?.results) ? session.results : [])) {
        if (item?.status !== "sent") continue;
        const e = (item.recipientEmail ?? item.email ?? item.to ?? "").trim().toLowerCase();
        if (e) sent.add(e);
      }
    }
  }

  return sent;
}

// ─── Load leads ───────────────────────────────────────────────────────────────

function loadLeadsFromFile(path: string): ValidatedLead[] {
  const fullPath = resolve(ROOT, path);
  if (!existsSync(fullPath)) { console.error(`Not found: ${fullPath}`); return []; }
  const data = JSON.parse(readFileSync(fullPath, "utf8").replace(/^﻿/, ""));
  return Array.isArray(data.leads) ? data.leads : Array.isArray(data) ? data : [];
}

const sentEmails = loadSentEmails();

let allLeads: ValidatedLead[] = [];
if (ALL_MODE) {
  for (const src of ALL_SOURCES) allLeads.push(...loadLeadsFromFile(src));
} else {
  allLeads = loadLeadsFromFile(SOURCE!);
}

// Deduplicate by primaryEmail
const byEmail = new Map<string, ValidatedLead>();
for (const lead of allLeads) {
  const e = (lead.primaryEmail ?? "").trim().toLowerCase();
  if (e && !byEmail.has(e)) byEmail.set(e, lead);
}

// Filter: skip already sent + optionally HOT only
let leads = [...byEmail.values()].filter((l) => {
  const e = (l.primaryEmail ?? "").trim().toLowerCase();
  if (!e || sentEmails.has(e)) return false;
  if (HOT_ONLY && l.status !== "HOT") return false;
  if (l.status === "INVALID") return false;
  return true;
});

// Sort: HOT first, then by outreachPriority desc
leads.sort((a, b) => {
  if (a.status !== b.status) return a.status === "HOT" ? -1 : 1;
  return (b.outreachPriority ?? 0) - (a.outreachPriority ?? 0);
});

const toProcess = leads.slice(0, LIMIT);

// ─── PDF pre-flight validation ────────────────────────────────────────────────

if (!PREVIEW_ONLY) {
  if (!ATTACH_PATH) {
    console.error("ABORTED — MEDIA_KIT_PDF not configured.");
    console.error("  Set MEDIA_KIT_PDF in .env or pass --attach <path>.");
    process.exit(1);
  }
  if (!existsSync(ATTACH_PATH)) {
    console.error(`ABORTED — Media kit PDF not found: ${ATTACH_PATH}`);
    console.error("  Verify the path and try again.");
    process.exit(1);
  }
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  bold:   (s: string) => USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s,
  dim:    (s: string) => USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s,
  green:  (s: string) => USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s,
  yellow: (s: string) => USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s,
  red:    (s: string) => USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s,
  cyan:   (s: string) => USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s,
};
const hr = "═".repeat(70);

// ─── Header ───────────────────────────────────────────────────────────────────

console.log(`\n${c.bold("VRASHOWS — Cold Outreach Sender")}`);
console.log(c.dim(`Source: ${ALL_MODE ? "all sources" : SOURCE}  ·  Mode: ${DRY_RUN ? "DRY-RUN" : "LIVE"}`));
console.log(hr);
console.log(`  Total loaded:         ${allLeads.length}`);
console.log(`  Already contacted:    ${sentEmails.size}`);
console.log(`  Eligible to send:     ${leads.length}`);
console.log(`  This batch:           ${toProcess.length} (limit: ${LIMIT})`);
console.log(`  Attachment:           ${ATTACH_PATH && existsSync(ATTACH_PATH) ? ATTACH_PATH : "none"}`);
console.log(`  BCC:                  ${BCC_ADDRESS ?? "none"}`);
console.log(`  Rate delay:           ${RATE_DELAY}ms`);
console.log(hr);

if (leads.length === 0) {
  console.log(`\n${c.green("All leads already contacted or no eligible leads found.")}\n`);
  process.exit(0);
}

// ─── Preview ──────────────────────────────────────────────────────────────────

console.log(`\n${c.bold("EMAIL PREVIEWS")}\n`);
for (const lead of toProcess) {
  const email = buildPersonalizedEmail(lead);
  const pLabel = lead.status === "HOT" ? c.green("[HOT]") : c.yellow("[WARM]");
  console.log(`  ${pLabel} ${c.bold(lead.contactName.padEnd(26))} ${lead.primaryEmail}`);
  console.log(`  ${c.dim("Role:")}    ${lead.role} @ ${lead.company}`);
  console.log(`  ${c.dim("Subject:")} ${email.subject}`);
  console.log(`  ${c.dim("Quality:")} ${email.quality.score}/100 (${email.quality.decision})`);
  const preview = email.bodyText.split("\n").filter((l) => l.trim()).slice(0, 2).join(" · ");
  console.log(`  ${c.dim("Preview:")} ${c.dim(preview.slice(0, 100))}${preview.length > 100 ? "…" : ""}`);
  console.log();
}

if (PREVIEW_ONLY) {
  console.log(`${c.cyan("Preview-only — no emails sent.")}\n`);
  process.exit(0);
}

// ─── Execute sends ────────────────────────────────────────────────────────────

console.log(hr);
console.log(`\n${c.bold(DRY_RUN ? "DRY-RUN (staged)" : "⚡ LIVE SEND")}\n`);

const sessionStart = new Date().toISOString();
const results: Array<{ lead: ValidatedLead; status: string; resendId?: string | null; elapsed: number; error?: string }> = [];
let sent = 0;
let failed = 0;

for (let i = 0; i < toProcess.length; i++) {
  const lead = toProcess[i]!;
  const email = buildPersonalizedEmail(lead);
  const startMs = Date.now();

  try {
    const record = await sendEmail(
      {
        company: lead.company,
        contactName: lead.contactName,
        recipientEmail: lead.primaryEmail,
        subject: email.subject,
        bodyText: email.bodyText,
        bodyHtml: email.bodyHtml,
        emailType: "cold-outreach",
        sequenceNumber: 1,
        ...(ATTACH_PATH && existsSync(ATTACH_PATH) ? { attachmentPath: ATTACH_PATH } : {}),
      },
      { dryRun: DRY_RUN, rateDelayMs: RATE_DELAY, bcc: BCC_ADDRESS, deduplicationWindowDays: 7 }
    );

    const elapsed = Date.now() - startMs;
    const ok = record.status === "sent" || record.status === "queued";
    if (ok) sent++; else failed++;
    results.push({ lead, status: record.status, resendId: record.resendId, elapsed, error: record.error });

    // Real-time write to outbound-log.json so next batch deduplication works immediately
    if (ok && !DRY_RUN) {
      const logEntry = JSON.stringify({
        date: new Date().toISOString(),
        company: lead.company,
        contactName: lead.contactName,
        email: lead.primaryEmail,
        status: "sent",
        resendId: record.resendId ?? null,
        sentAt: new Date().toISOString(),
        source: "run-cold-outreach",
      });
      const outboundLogPath = resolve(LOGS_DIR, "outbound-log.json");
      const existing = existsSync(outboundLogPath)
        ? JSON.parse(readFileSync(outboundLogPath, "utf8")) as any[]
        : [];
      existing.push(JSON.parse(logEntry));
      writeFileSync(outboundLogPath, JSON.stringify(existing, null, 2), "utf8");
    }

    const statusColor = ok ? c.green : c.red;
    const pLabel = lead.status === "HOT" ? c.green("[HOT] ") : c.yellow("[WARM]");
    console.log(`  ${statusColor(record.status.toUpperCase().padEnd(8))} ${pLabel} ${c.bold(lead.contactName.padEnd(24))} → ${lead.primaryEmail}`);
    if (record.resendId) console.log(`           ${c.dim(`ID: ${record.resendId}  (${elapsed}ms)`)}`);
    if (record.error)    console.log(`           ${c.red(`Error: ${record.error}`)}`);

  } catch (err) {
    const elapsed = Date.now() - startMs;
    const msg = err instanceof Error ? err.message : String(err);
    failed++;
    results.push({ lead, status: "failed", elapsed, error: msg });
    console.log(`  ${c.red("FAILED  ")} [${lead.status}] ${c.bold(lead.contactName)} → ${lead.primaryEmail}`);
    console.log(`           ${c.red(`Error: ${msg}`)}`);
  }
}

// ─── Session report ───────────────────────────────────────────────────────────

const sessionEnd = new Date().toISOString();
const logDir = resolve(ROOT, "logs/outreach");
mkdirSync(logDir, { recursive: true });
const reportFile = resolve(logDir, `cold-outreach-${sessionStart.replace(/[:.]/g, "-")}.json`);

writeFileSync(reportFile, JSON.stringify({
  sessionId: `cold-outreach-${sessionStart.replace(/[:.]/g, "-")}`,
  source: SOURCE ?? "all-sources",
  mode: DRY_RUN ? "dry-run" : "live",
  campaign: "futurecom-2026-enterprise-expansion",
  targetEvent: "Futurecom 2026",
  sessionStartedAt: sessionStart,
  sessionCompletedAt: sessionEnd,
  bcc: BCC_ADDRESS ?? null,
  attachmentPath: ATTACH_PATH ?? null,
  totalAttempted: toProcess.length,
  sent,
  failed,
  results: results.map((r) => ({
    company: r.lead.company,
    contactName: r.lead.contactName,
    recipientEmail: r.lead.primaryEmail,
    subject: buildPersonalizedEmail(r.lead).subject,
    status: r.status,
    resendId: r.resendId ?? null,
    elapsed: r.elapsed,
    error: r.error ?? null,
    qualityScore: buildPersonalizedEmail(r.lead).quality.score,
    outreachPriority: r.lead.outreachPriority,
    sentAt: sessionEnd,
  })),
}, null, 2), "utf8");

console.log(`\n${hr}`);
console.log(`  ${c.bold("SESSION COMPLETE")}  [${DRY_RUN ? c.yellow("DRY-RUN") : c.green("LIVE")}]`);
console.log(`  Sent:    ${c.green(String(sent).padStart(3))}`);
console.log(`  Failed:  ${c.red(String(failed).padStart(3))}`);
console.log(`  Report:  ${reportFile}`);
console.log(hr + "\n");
