#!/usr/bin/env tsx
/**
 * run-futurecom-full.ts — Full Futurecom 2026 outbound in controlled batches of 5
 *
 * Reads validated-remaining20.json, splits into batches of 5, sends each batch
 * with 3-min spacing between individual emails and 10-min pause between batches.
 *
 * Safety: dry-run by default — pass --live to send real emails.
 *
 * Usage:
 *   tsx scripts/run-futurecom-full.ts                        # dry-run
 *   tsx scripts/run-futurecom-full.ts --preview-only         # show all email previews
 *   tsx scripts/run-futurecom-full.ts --live                 # send all 4 batches
 *   tsx scripts/run-futurecom-full.ts --live --start-batch 2 # resume from batch 2
 *   tsx scripts/run-futurecom-full.ts --live --batch-pause 600000  # 10-min inter-batch
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
const BATCH_SIZE   = 5; // fixed per spec
const START_BATCH  = parseInt(val("--start-batch") ?? "1", 10); // 1-indexed
const RATE_DELAY   = parseInt(val("--rate-delay")   ?? (LIVE ? "180000" : "0"), 10);  // between emails
const BATCH_PAUSE  = parseInt(val("--batch-pause")  ?? (LIVE ? "600000" : "0"), 10);  // between batches
const JSON_OUT     = flag("--json");

// ─── Config ───────────────────────────────────────────────────────────────────

const LEADS_FILE   = resolve(ROOT, "data/leads/futurecom/validated-remaining20.json");
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
  blue:   (s: string) => USE_COLOR ? `\x1b[34m${s}\x1b[0m` : s,
};

function fmtMs(ms: number): string {
  if (ms >= 60000) return `${Math.round(ms / 60000)} min`;
  return `${Math.round(ms / 1000)}s`;
}

// ─── Load and partition leads ─────────────────────────────────────────────────

interface FuturecomLeadFile {
  _meta: Record<string, string>;
  campaign: string;
  targetEvent: string;
  leads: ValidatedLead[];
}

const raw     = JSON.parse(readFileSync(LEADS_FILE, "utf8")) as FuturecomLeadFile;
const allLeads = raw.leads.filter(l => l.status === "HOT" || l.status === "WARM");

// Chunk into batches of BATCH_SIZE
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const allBatches  = chunk(allLeads, BATCH_SIZE);
const batches     = allBatches.slice(START_BATCH - 1); // start from --start-batch
const hasAttachment = ATTACH_PATH ? existsSync(ATTACH_PATH) : false;

// ─── Header ───────────────────────────────────────────────────────────────────

if (!JSON_OUT) {
  const hr = "═".repeat(70);
  console.log(`\n${c.bold("VRASHOWS — Futurecom 2026 · Full Outbound (batches de 5)")}`);
  console.log(c.dim(`Campaign: ${CAMPAIGN}`));
  console.log(hr);
  console.log(`  Modo:           ${DRY_RUN ? c.yellow("DRY-RUN (passe --live para enviar)") : c.red("⚡ LIVE SEND")}`);
  console.log(`  Total leads:    ${c.bold(String(allLeads.length))} leads (HOT: ${allLeads.filter(l => l.status === "HOT").length} · WARM: ${allLeads.filter(l => l.status === "WARM").length})`);
  console.log(`  Batches:        ${c.bold(String(allBatches.length))} batches de ${BATCH_SIZE}`);
  if (START_BATCH > 1) console.log(`  Iniciando em:   batch ${START_BATCH} de ${allBatches.length}`);
  console.log(`  BCC:            ${BCC_ADDRESS}`);
  console.log(`  Anexo PDF:      ${hasAttachment ? c.green("encontrado ✓") : c.yellow("não encontrado")}`);
  if (LIVE) {
    console.log(`  Intervalo email: ${c.cyan(fmtMs(RATE_DELAY))} entre envios`);
    console.log(`  Pausa batch:    ${c.cyan(fmtMs(BATCH_PAUSE))} entre batches`);
    const totalMin = Math.round(
      ((allLeads.length - 1) * RATE_DELAY + (allBatches.length - 1) * BATCH_PAUSE) / 60000
    );
    console.log(`  Tempo total:    ~${totalMin} min (~${Math.round(totalMin / 60)}h)`);
  }
  console.log(hr);
}

// ─── Preview all ──────────────────────────────────────────────────────────────

if (!JSON_OUT) {
  for (let bi = 0; bi < allBatches.length; bi++) {
    const batch = allBatches[bi]!;
    const isActive = bi >= START_BATCH - 1;

    console.log(`\n${c.bold(`BATCH ${bi + 1}/${allBatches.length}`)} ${isActive ? "" : c.dim("(já enviado / ignorado)")}\n`);

    for (let i = 0; i < batch.length; i++) {
      const lead  = batch[i]!;
      const email = buildPersonalizedEmail(lead);
      const qualColor =
        email.quality.decision === "send"   ? c.green  :
        email.quality.decision === "review" ? c.yellow : c.red;
      const statusColor = lead.status === "HOT" ? c.green : c.yellow;

      console.log(`  ${statusColor(`[${lead.status}]`)} ${c.bold(lead.contactName)} — ${lead.company}`);
      console.log(`  ${c.dim("Para:")}      ${lead.primaryEmail}  ${c.dim(`·  Q: ${qualColor(`${email.quality.score}/100`)}`)}  ${c.dim(`·  Prio: ${lead.outreachPriority}`)}`);
      console.log(`  ${c.dim("Assunto:")}   ${email.subject}`);
      console.log();
    }
  }
}

if (PREVIEW_ONLY) {
  if (!JSON_OUT) console.log(`${c.cyan("Preview-only — nenhum email enviado.")}\n`);
  process.exit(0);
}

// ─── Execute batches ──────────────────────────────────────────────────────────

if (!JSON_OUT) {
  console.log("─".repeat(70));
  console.log(`\n${c.bold(DRY_RUN ? "SIMULANDO ENVIOS (dry-run)" : "EXECUTANDO ENVIOS — LIVE")}\n`);
}

const sessionStart = new Date().toISOString();

interface BatchResult {
  batchIndex: number;
  company: string;
  contactName: string;
  recipientEmail: string;
  subject: string;
  status: string;
  resendId: string | null;
  elapsed: number;
  qualityScore: number;
  outreachPriority: number;
  error: string | null;
  sentAt: string;
}

const allResults: BatchResult[] = [];
let totalSent   = 0;
let totalFailed = 0;

for (let bi = 0; bi < batches.length; bi++) {
  const batch      = batches[bi]!;
  const batchIndex = bi + START_BATCH; // 1-indexed display number

  if (!JSON_OUT) {
    const hr = "─".repeat(70);
    console.log(hr);
    const hotCount  = batch.filter(l => l.status === "HOT").length;
    const warmCount = batch.filter(l => l.status === "WARM").length;
    console.log(`${c.bold(`  BATCH ${batchIndex}/${allBatches.length}`)}  [HOT: ${hotCount} · WARM: ${warmCount}]\n`);
  }

  let batchSent   = 0;
  let batchFailed = 0;

  for (let i = 0; i < batch.length; i++) {
    const lead   = batch[i]!;
    const email  = buildPersonalizedEmail(lead);
    const sentAt = new Date().toISOString();

    // Rate delay between emails (not before first in batch)
    if (i > 0 && LIVE && RATE_DELAY > 0) {
      if (!JSON_OUT) console.log(`  ${c.dim(`⏱  Aguardando ${fmtMs(RATE_DELAY)} antes do próximo envio...`)}\n`);
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
          dryRun:      DRY_RUN,
          rateDelayMs: 0,
          bcc:         BCC_ADDRESS,
        }
      );

      const elapsed = Date.now() - startMs;
      const ok = record.status === "sent" || record.status === "queued";
      if (ok) { batchSent++; totalSent++; } else { batchFailed++; totalFailed++; }

      allResults.push({
        batchIndex,
        company:          lead.company,
        contactName:      lead.contactName,
        recipientEmail:   lead.primaryEmail,
        subject:          email.subject,
        status:           record.status,
        resendId:         record.resendId ?? null,
        elapsed,
        qualityScore:     email.quality.score,
        outreachPriority: lead.outreachPriority,
        error:            record.error ?? null,
        sentAt,
      });

      if (!JSON_OUT) {
        const prioLabel   = lead.status === "HOT" ? c.green("[HOT] ") : c.yellow("[WARM]");
        const statusLabel = ok ? c.green(record.status.toUpperCase().padEnd(8)) : c.red(record.status.toUpperCase().padEnd(8));
        console.log(
          `  ${statusLabel} ${prioLabel} ${c.bold(lead.contactName.padEnd(22))} → ${lead.primaryEmail}`
        );
        console.log(`           ${c.dim(`${lead.company} · Q:${email.quality.score}/100 · ${elapsed}ms`)}`);
        if (record.resendId) console.log(`           ${c.dim(`Resend ID: ${record.resendId}`)}`);
        if (record.error)    console.log(`           ${c.red(`Erro: ${record.error}`)}`);
        console.log();
      }

    } catch (err) {
      const elapsed = Date.now() - startMs;
      const message = err instanceof Error ? err.message : String(err);
      batchFailed++; totalFailed++;
      allResults.push({
        batchIndex,
        company:          lead.company,
        contactName:      lead.contactName,
        recipientEmail:   lead.primaryEmail,
        subject:          email.subject,
        status:           "failed",
        resendId:         null,
        elapsed,
        qualityScore:     email.quality.score,
        outreachPriority: lead.outreachPriority,
        error:            message,
        sentAt,
      });
      if (!JSON_OUT) {
        console.log(`  ${c.red("FAILED  ")} ${c.bold(lead.contactName)} → ${lead.primaryEmail}`);
        console.log(`           ${c.red(`Erro: ${message}`)}`);
        console.log();
      }
    }
  }

  if (!JSON_OUT) {
    console.log(`  ${c.dim(`Batch ${batchIndex} concluído — enviados: ${batchSent} · falhos: ${batchFailed}`)}`);
  }

  // Inter-batch pause (not after last batch)
  if (bi < batches.length - 1 && LIVE && BATCH_PAUSE > 0) {
    if (!JSON_OUT) {
      console.log(`\n  ${c.cyan(`⏸  Pausa de ${fmtMs(BATCH_PAUSE)} antes do próximo batch (${batchIndex + 1}/${allBatches.length})...`)}\n`);
    }
    await new Promise<void>((r) => setTimeout(r, BATCH_PAUSE));
  }
}

// ─── Delivery report ──────────────────────────────────────────────────────────

const sessionEnd = new Date().toISOString();
const sessionId  = `futurecom-full-${sessionStart.replace(/[:.]/g, "-").slice(0, 23)}`;

const report = {
  sessionId,
  campaign:           CAMPAIGN,
  targetEvent:        TARGET_EVENT,
  mode:               DRY_RUN ? "dry-run" : "live",
  bcc:                BCC_ADDRESS,
  attachmentPath:     hasAttachment ? ATTACH_PATH : null,
  batchSize:          BATCH_SIZE,
  totalBatches:       allBatches.length,
  startBatch:         START_BATCH,
  rateDelayMs:        RATE_DELAY,
  batchPauseMs:       BATCH_PAUSE,
  sessionStartedAt:   sessionStart,
  sessionCompletedAt: sessionEnd,
  totalAttempted:     allResults.length,
  sent:               totalSent,
  failed:             totalFailed,
  results:            allResults,
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
console.log(`\n${hr2}`);
console.log(`  ${c.bold("FULL BATCH CONCLUÍDO")}  [${DRY_RUN ? c.yellow("DRY-RUN") : c.green("LIVE")}]`);
console.log(`  Tentativas: ${c.bold(String(allResults.length).padStart(3))}`);
console.log(`  Enviados:   ${c.green(String(totalSent).padStart(3))}`);
console.log(`  Falhos:     ${c.red(String(totalFailed).padStart(3))}`);
console.log(`  Relatório:  ${c.dim(reportFile)}`);
console.log(hr2);
console.log();

if (!LIVE && !JSON_OUT) {
  console.log(`  ${c.cyan("→")} Dry-run concluído. Execute com ${c.bold("--live")} para enviar os emails reais.\n`);
}
