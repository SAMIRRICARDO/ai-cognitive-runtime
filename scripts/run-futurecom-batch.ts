#!/usr/bin/env tsx
/**
 * run-futurecom-batch.ts — First controlled enterprise outbound batch
 *
 * Target:  Futurecom 2026 · Top 5 HOT leads
 * Source:  data/leads/futurecom/validated-top5.json
 * Safety:  dry-run by default — pass --live to send real emails
 *
 * Usage:
 *   tsx scripts/run-futurecom-batch.ts                       # dry-run (safe preview)
 *   tsx scripts/run-futurecom-batch.ts --preview-only        # show email content, no send
 *   tsx scripts/run-futurecom-batch.ts --live                # send (3-min spacing)
 *   tsx scripts/run-futurecom-batch.ts --live --limit 2      # send first 2 only
 *   tsx scripts/run-futurecom-batch.ts --live --rate-delay 120000  # 2-min spacing
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { sendEmail } from "../tools/send-email.js";
import { buildPersonalizedEmail } from "../agents/outreach-builder/builder.js";
import type { ValidatedLead } from "../agents/lead-validation/types.js";
import { env } from "../config/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const val  = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };

const LIVE         = flag("--live");
const DRY_RUN      = !LIVE;
const PREVIEW_ONLY = flag("--preview-only");
const LIMIT        = Math.min(parseInt(val("--limit") ?? "5", 10), 5); // hard cap: 5
const RATE_DELAY   = parseInt(val("--rate-delay") ?? (LIVE ? "180000" : "0"), 10);
const JSON_OUT     = flag("--json");

// ─── Config ───────────────────────────────────────────────────────────────────

const LEADS_FILE   = resolve(ROOT, "data/leads/futurecom/validated-top5.json");
const ATTACH_PATH  = val("--attach") ?? env.MEDIA_KIT_PDF ?? undefined;
const BCC_ADDRESS  = env.OUTBOUND_BCC_EMAIL ?? undefined;
const CAMPAIGN     = "futurecom-2026-enterprise-v1";
const TARGET_EVENT = "Futurecom 2026";

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

// ─── Load leads ───────────────────────────────────────────────────────────────

interface FuturecomLeadFile {
  _meta: Record<string, string>;
  campaign: string;
  targetEvent: string;
  validatedAt: string;
  leads: ValidatedLead[];
}

const raw = JSON.parse(readFileSync(LEADS_FILE, "utf8")) as FuturecomLeadFile;
const allLeads = raw.leads.filter(l => l.status === "HOT" || l.status === "WARM");
const leads = allLeads.slice(0, LIMIT);

const hasAttachment = ATTACH_PATH ? existsSync(ATTACH_PATH) : false;

// ─── Header ───────────────────────────────────────────────────────────────────

if (!JSON_OUT) {
  const hr = "═".repeat(70);
  const rateLabel = RATE_DELAY >= 60000
    ? `${Math.round(RATE_DELAY / 60000)} min`
    : `${Math.round(RATE_DELAY / 1000)}s`;

  console.log(`\n${c.bold("VRASHOWS — Futurecom 2026 · Enterprise Outbound Batch")}`);
  console.log(c.dim(`Campaign: ${CAMPAIGN}`));
  console.log(hr);
  console.log(`  Modo:       ${DRY_RUN ? c.yellow("DRY-RUN (passe --live para enviar)") : c.red("⚡ LIVE SEND")}`);
  console.log(`  Leads:      ${c.bold(String(leads.length))} de ${allLeads.length} disponíveis (HOT: ${leads.filter(l => l.status === "HOT").length})`);
  console.log(`  BCC:        ${BCC_ADDRESS}`);
  console.log(`  Anexo PDF:  ${hasAttachment ? c.green("encontrado ✓") : c.yellow("não encontrado — envio sem PDF")}`);
  if (!hasAttachment) console.log(`  PDF path:   ${c.dim(ATTACH_PATH ?? "not configured")}`);
  if (LIVE && RATE_DELAY > 0) {
    console.log(`  Intervalo:  ${c.cyan(rateLabel)} entre envios (comportamento humano)`);
  }
  console.log(hr);
}

// ─── Preview ──────────────────────────────────────────────────────────────────

if (!JSON_OUT) {
  console.log(`\n${c.bold("EMAILS — PRÉVIA COMPLETA")}\n`);

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i]!;
    const email = buildPersonalizedEmail(lead);
    const statusColor = lead.status === "HOT" ? c.green : c.yellow;

    const qualColor =
      email.quality.decision === "send"   ? c.green  :
      email.quality.decision === "review" ? c.yellow : c.red;

    console.log(`  ${c.bold(`[${i + 1}/${leads.length}]`)} ${statusColor(`[${lead.status}]`)} ${c.bold(lead.contactName)}`);
    console.log(`  ${c.dim("Empresa:")}     ${lead.company} · ${lead.role}`);
    console.log(`  ${c.dim("Para:")}        ${lead.primaryEmail}`);
    console.log(`  ${c.dim("BCC:")}         ${BCC_ADDRESS}`);
    console.log(`  ${c.dim("Assunto:")}     ${email.subject}`);
    console.log(`  ${c.dim("Qualidade:")}   ${qualColor(`${email.quality.score}/100 (${email.quality.decision})`)}`);
    console.log(`  ${c.dim("Prioridade:")}  ${lead.outreachPriority}/100 · Confiança: ${lead.confidence}`);
    console.log(`  ${c.dim("ABRINT case:")} ${lead.useCaseABRINT ? "sim" : "não"}`);

    // First 3 non-empty lines of body
    const preview = email.bodyText
      .split("\n")
      .filter(l => l.trim())
      .slice(0, 3)
      .join(" · ");
    console.log(`  ${c.dim("Preview:")}     ${c.dim(preview.slice(0, 120))}${preview.length > 120 ? "…" : ""}`);

    if (email.quality.issues.length > 0) {
      console.log(`  ${c.yellow("Issues:")}      ${email.quality.issues.slice(0, 2).join("; ")}`);
    }
    console.log();
  }
}

if (PREVIEW_ONLY) {
  if (!JSON_OUT) console.log(`${c.cyan("Preview-only — nenhum email enviado.")}\n`);
  process.exit(0);
}

// ─── Execute batch ────────────────────────────────────────────────────────────

if (!JSON_OUT) {
  console.log("─".repeat(70));
  console.log(`\n${c.bold(DRY_RUN ? "SIMULANDO ENVIOS (dry-run)" : "EXECUTANDO ENVIOS — LIVE")}\n`);
}

const sessionStart = new Date().toISOString();

interface BatchResult {
  index: number;
  company: string;
  contactName: string;
  recipientEmail: string;
  subject: string;
  status: string;
  resendId: string | null;
  elapsed: number;
  qualityScore: number;
  outreachPriority: number;
  bcc: string | null;
  hasAttachment: boolean;
  error: string | null;
  sentAt: string;
}

const results: BatchResult[] = [];
let sent = 0;
let failed = 0;

for (let i = 0; i < leads.length; i++) {
  const lead = leads[i]!;
  const email = buildPersonalizedEmail(lead);
  const sentAt = new Date().toISOString();

  // Rate delay BEFORE send (except first) — managed externally for precise logging
  if (i > 0 && LIVE && RATE_DELAY > 0) {
    const rateLabel = RATE_DELAY >= 60000
      ? `${Math.round(RATE_DELAY / 60000)} min`
      : `${Math.round(RATE_DELAY / 1000)}s`;
    if (!JSON_OUT) {
      console.log(`  ${c.dim(`⏱  Aguardando ${rateLabel} antes do próximo envio...`)}\n`);
    }
    await new Promise<void>((r) => setTimeout(r, RATE_DELAY));
  }

  const startMs = Date.now();

  try {
    const record = await sendEmail(
      {
        company:        lead.company,
        contactName:    lead.contactName,
        recipientEmail: lead.primaryEmail,
        subject:        email.subject,
        bodyText:       email.bodyText,
        bodyHtml:       email.bodyHtml,
        emailType:      "cold-outreach",
        sequenceNumber: 1,
        ...(hasAttachment && ATTACH_PATH ? { attachmentPath: ATTACH_PATH } : {}),
      },
      {
        dryRun:       DRY_RUN,
        rateDelayMs:  0, // delay managed externally above
        bcc:          BCC_ADDRESS,
      }
    );

    const elapsed = Date.now() - startMs;
    const ok = record.status === "sent" || record.status === "queued";
    if (ok) sent++; else failed++;

    results.push({
      index:           i + 1,
      company:         lead.company,
      contactName:     lead.contactName,
      recipientEmail:  lead.primaryEmail,
      subject:         email.subject,
      status:          record.status,
      resendId:        record.resendId ?? null,
      elapsed,
      qualityScore:    email.quality.score,
      outreachPriority: lead.outreachPriority,
      bcc:             BCC_ADDRESS ?? null,
      hasAttachment,
      error:           record.error ?? null,
      sentAt,
    });

    if (!JSON_OUT) {
      const prioLabel   = lead.status === "HOT" ? c.green("[HOT] ") : c.yellow("[WARM]");
      const statusLabel = ok ? c.green(record.status.toUpperCase().padEnd(8)) : c.red(record.status.toUpperCase().padEnd(8));
      console.log(
        `  ${statusLabel} ${prioLabel} ${c.bold(`[${i + 1}/${leads.length}]`)} ` +
        `${c.bold(lead.contactName.padEnd(22))} → ${lead.primaryEmail}`
      );
      console.log(`           ${c.dim(`${lead.company} · Q:${email.quality.score}/100 · ${elapsed}ms`)}`);
      if (record.resendId) console.log(`           ${c.dim(`Resend ID: ${record.resendId}`)}`);
      if (record.error)    console.log(`           ${c.red(`Erro: ${record.error}`)}`);
      console.log();
    }

  } catch (err) {
    const elapsed = Date.now() - startMs;
    const message = err instanceof Error ? err.message : String(err);
    failed++;
    results.push({
      index:           i + 1,
      company:         lead.company,
      contactName:     lead.contactName,
      recipientEmail:  lead.primaryEmail,
      subject:         email.subject,
      status:          "failed",
      resendId:        null,
      elapsed,
      qualityScore:    email.quality.score,
      outreachPriority: lead.outreachPriority,
      bcc:             BCC_ADDRESS ?? null,
      hasAttachment,
      error:           message,
      sentAt,
    });
    if (!JSON_OUT) {
      console.log(`  ${c.red("FAILED  ")} ${c.bold(`[${i + 1}/${leads.length}]`)} ${c.bold(lead.contactName)} → ${lead.primaryEmail}`);
      console.log(`           ${c.red(`Erro: ${message}`)}`);
      console.log();
    }
  }
}

// ─── Delivery report ──────────────────────────────────────────────────────────

const sessionEnd = new Date().toISOString();
const sessionId  = `futurecom-batch-${sessionStart.replace(/[:.]/g, "-").slice(0, 23)}`;

const report = {
  sessionId,
  campaign:           CAMPAIGN,
  targetEvent:        TARGET_EVENT,
  mode:               DRY_RUN ? "dry-run" : "live",
  bcc:                BCC_ADDRESS,
  attachmentPath:     hasAttachment ? ATTACH_PATH : null,
  rateDelayMs:        RATE_DELAY,
  sessionStartedAt:   sessionStart,
  sessionCompletedAt: sessionEnd,
  totalAttempted:     leads.length,
  sent,
  failed,
  results,
};

const logDir     = resolve(ROOT, "logs/outreach");
mkdirSync(logDir, { recursive: true });
const reportFile = resolve(logDir, `${sessionId}.json`);
writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf8");

// ─── Final summary ────────────────────────────────────────────────────────────

if (JSON_OUT) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exit(0);
}

const hr2 = "═".repeat(70);
console.log(hr2);
console.log(`  ${c.bold("BATCH CONCLUÍDO")}  [${DRY_RUN ? c.yellow("DRY-RUN") : c.green("LIVE")}]`);
console.log(`  Enviados:  ${c.green(String(sent).padStart(3))}`);
console.log(`  Falhos:    ${c.red(String(failed).padStart(3))}`);
console.log(`  Relatório: ${c.dim(reportFile)}`);
console.log(hr2);
console.log();

if (!LIVE && !JSON_OUT) {
  console.log(`  ${c.cyan("→")} Dry-run concluído. Execute com ${c.bold("--live")} para enviar os emails reais.\n`);
}
