#!/usr/bin/env tsx
/**
 * run-institutional-followup.ts — Institutional complement with VRASHOWS media kit
 *
 * Sends an elegant institutional follow-up to all previously contacted leads,
 * delivering the media kit PDF as a professional complement to the cold outreach.
 * This is NOT a correction — it is framed as a natural continuation of the
 * relationship, sharing reference material for when the timing is right.
 *
 * FLOW (mandatory):
 *   Step 1 — --test      sends to samir.ricardo@vrashows.com.br for visual approval
 *   Step 2 — --live --confirmed   after approval, sends to all eligible contacts
 *
 * Usage:
 *   tsx scripts/run-institutional-followup.ts --preview
 *   tsx scripts/run-institutional-followup.ts --test
 *   tsx scripts/run-institutional-followup.ts --test --test-to other@email.com
 *   tsx scripts/run-institutional-followup.ts --live --confirmed
 *   tsx scripts/run-institutional-followup.ts --live --confirmed --limit 20
 *   tsx scripts/run-institutional-followup.ts --live --confirmed --rate-delay 180000
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { sendEmail } from "../tools/send-email.js";
import { env } from "../config/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");
const LOGS_DIR  = resolve(ROOT, "logs");
const OUTREACH_DIR = resolve(LOGS_DIR, "outreach");
const LOG_FILE  = resolve(LOGS_DIR, "institutional-followup-log.json");

// ─── CLI ───────────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2);
const flag        = (f: string) => args.includes(f);
const val         = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };

const TEST_MODE   = flag("--test");
const LIVE        = flag("--live");
const CONFIRMED   = flag("--confirmed");
const PREVIEW     = flag("--preview") || flag("--preview-only");
const LIMIT       = parseInt(val("--limit") ?? "999", 10);
const RATE_DELAY  = parseInt(val("--rate-delay") ?? (LIVE ? "180000" : "0"), 10);
const TEST_EMAIL  = val("--test-to") ?? "samir.ricardo@vrashows.com.br";
const ATTACH_PATH = val("--attach") ?? env.MEDIA_KIT_PDF ?? undefined;
const BCC         = env.OUTBOUND_BCC_EMAIL ?? undefined;
const DRY_RUN     = !LIVE;

// ─── Guards ───────────────────────────────────────────────────────────────────

if (!TEST_MODE && !PREVIEW && LIVE && !CONFIRMED) {
  console.error("\nABORTED — mass send requires --confirmed flag.\n");
  console.error("  Step 1 (test):     npx tsx scripts/run-institutional-followup.ts --test");
  console.error("  Step 2 (approve):  check email at samir.ricardo@vrashows.com.br");
  console.error("  Step 3 (send all): npx tsx scripts/run-institutional-followup.ts --live --confirmed\n");
  process.exit(1);
}

if (!PREVIEW) {
  if (!ATTACH_PATH) {
    console.error("\nABORTED — MEDIA_KIT_PDF not configured.");
    console.error("  Set MEDIA_KIT_PDF in .env or pass --attach <path>\n");
    process.exit(1);
  }
  if (!existsSync(ATTACH_PATH)) {
    console.error(`\nABORTED — Media kit PDF not found: ${ATTACH_PATH}\n`);
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContactRecord {
  company: string;
  contactName?: string;
  email: string;
  sentAt: string;
  source: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; }
}

function normalize(email?: string | null): string {
  return (email ?? "").trim().toLowerCase();
}

// ─── Load all contacts who received cold outreach ─────────────────────────────

function loadAllContacts(): ContactRecord[] {
  const byEmail = new Map<string, ContactRecord>();

  // Outbound log (realtime-written entries)
  const outbound = readJson<any[]>(resolve(LOGS_DIR, "outbound-log.json"), []);
  for (const item of outbound) {
    if (item?.status !== "sent") continue;
    const email = normalize(item.email ?? item.recipientEmail ?? item.to);
    const sentAt = item.sentAt ?? item.date;
    if (!email || !sentAt) continue;
    if (!byEmail.has(email)) {
      byEmail.set(email, {
        company: String(item.company ?? ""),
        contactName: item.contactName ? String(item.contactName) : undefined,
        email,
        sentAt,
        source: "outbound-log.json",
      });
    }
  }

  // Session files in logs/outreach/
  if (existsSync(OUTREACH_DIR)) {
    const files = readdirSync(OUTREACH_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort();

    for (const file of files) {
      const session = readJson<any>(join(OUTREACH_DIR, file), null);
      const results: any[] = Array.isArray(session?.results) ? session.results : [];
      for (const item of results) {
        if (item?.status !== "sent") continue;
        const email = normalize(item.recipientEmail ?? item.email ?? item.to);
        const sentAt = item.sentAt ?? session.sessionStartedAt;
        if (!email || !sentAt) continue;
        const existing = byEmail.get(email);
        if (!existing) {
          byEmail.set(email, {
            company: String(item.company ?? ""),
            contactName: item.contactName ? String(item.contactName) : undefined,
            email,
            sentAt,
            source: `outreach/${file}`,
          });
        } else if (!existing.contactName && item.contactName) {
          existing.contactName = String(item.contactName);
        }
      }
    }
  }

  return [...byEmail.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

// ─── Already received this follow-up ─────────────────────────────────────────

function loadAlreadySent(): Set<string> {
  const log = readJson<any>(LOG_FILE, { results: [] });
  const sent = new Set<string>();
  for (const entry of log.results ?? []) {
    if (entry?.status === "sent") sent.add(normalize(entry.email));
  }
  return sent;
}

// ─── Blocked / bounced / unsubscribed ────────────────────────────────────────

function loadBlocked(): Set<string> {
  const blocked = new Set<string>();

  for (const item of readJson<any[]>(resolve(LOGS_DIR, "replies.json"), [])) {
    const email = normalize(item?.from ?? item?.email);
    if (email) blocked.add(email);
  }
  for (const item of readJson<any[]>(resolve(LOGS_DIR, "resend-log.json"), [])) {
    const email = normalize(item?.to ?? item?.email ?? item?.recipientEmail);
    const status = String(item?.status ?? "").toLowerCase();
    if (email && (status.includes("bounce") || status.includes("unsubscribe") || status.includes("complained"))) {
      blocked.add(email);
    }
  }
  for (const item of readJson<any[]>(resolve(LOGS_DIR, "outbound-log.json"), [])) {
    const email = normalize(item?.email ?? item?.recipientEmail ?? item?.to);
    const status = String(item?.status ?? "").toLowerCase();
    if (email && (status.includes("bounce") || status.includes("unsubscribe"))) blocked.add(email);
  }

  return blocked;
}

// ─── Email builder ────────────────────────────────────────────────────────────

function buildEmail(contact: ContactRecord): { subject: string; bodyText: string; bodyHtml: string } {
  const firstName = contact.contactName
    ? contact.contactName.trim().split(/\s+/)[0]!
    : "";
  const company = contact.company || "sua empresa";
  const greeting = firstName ? `Olá ${firstName},` : "Olá,";

  const subject = `VRASHOWS · material institucional para o Futurecom 2026`;

  // Template oficial v3.0 — 2026-05-21
  const bodyText = `${greeting}

Grandes marcas não participam de eventos como o Futurecom apenas com um stand — existe toda uma operação estratégica por trás da experiência, logística e presença da marca no evento.

É exatamente nesse ponto que a VRASHOWS atua.

Somos especializados em operação completa para feiras de negócios e eventos enterprise, centralizando em um único parceiro tudo o que normalmente exige múltiplos fornecedores e uma grande carga operacional da equipe interna.

Cuidamos de toda a estrutura operacional para que sua equipe possa focar exclusivamente em relacionamento, networking e geração de negócios durante o evento.

Entre as soluções que entregamos:
• operação de stands e ativações
• vans executivas e transfers corporativos
• logística de brindes, alimentos e bebidas
• vans de carga e suporte operacional
• recepcionistas e modelos
• segurança
• fotógrafos e videomakers
• suporte operacional completo durante o evento
• coordenação e execução ponta a ponta

Nosso objetivo é transformar a participação da marca em eventos em uma operação organizada, eficiente e sem improvisos.

Anexei nosso material institucional para que você possa conhecer melhor a estrutura da VRASHOWS, nossa abordagem operacional e como apoiamos marcas em eventos B2B de alta complexidade.

Acredito que o material pode trazer insights interessantes para futuras operações e ativações da ${company} em eventos corporativos.

Também deixo nosso site para uma visão mais ampla das soluções:
www.vrashows.com.br

Fico à disposição caso faça sentido conversarmos em algum momento.

--
VRASHOWS
Operações & Experiência Corporativa · VRASHOWS
samir.ricardo@vrashows.com.br | www.vrashows.com.br
Whatsapp (11) 95357-7804`;

  const bodyHtml = `<p style="margin:0 0 18px;font-size:15px;">${greeting}</p>

<p style="margin:0 0 16px;">Grandes marcas não participam de eventos como o Futurecom apenas com um stand — existe toda uma operação estratégica por trás da experiência, logística e presença da marca no evento.</p>

<p style="margin:0 0 16px;">É exatamente nesse ponto que a <strong>VRASHOWS</strong> atua.</p>

<p style="margin:0 0 16px;">Somos especializados em operação completa para feiras de negócios e eventos enterprise, centralizando em um único parceiro tudo o que normalmente exige múltiplos fornecedores e uma grande carga operacional da equipe interna.</p>

<p style="margin:0 0 16px;">Cuidamos de toda a estrutura operacional para que sua equipe possa focar exclusivamente em relacionamento, networking e geração de negócios durante o evento.</p>

<p style="margin:0 0 10px;">Entre as soluções que entregamos:</p>
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; operação de stands e ativações</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; vans executivas e transfers corporativos</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; logística de brindes, alimentos e bebidas</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; vans de carga e suporte operacional</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; recepcionistas e modelos</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; segurança</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; fotógrafos e videomakers</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; suporte operacional completo durante o evento</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; coordenação e execução ponta a ponta</td></tr>
</table>

<p style="margin:0 0 16px;">Nosso objetivo é transformar a participação da marca em eventos em uma operação organizada, eficiente e sem improvisos.</p>

<p style="margin:0 0 16px;">Anexei nosso material institucional para que você possa conhecer melhor a estrutura da <strong>VRASHOWS</strong>, nossa abordagem operacional e como apoiamos marcas em eventos B2B de alta complexidade.</p>

<p style="margin:0 0 16px;">Acredito que o material pode trazer insights interessantes para futuras operações e ativações da <strong>${company}</strong> em eventos corporativos.</p>

<p style="margin:0 0 16px;">Também deixo nosso site para uma visão mais ampla das soluções: <a href="https://www.vrashows.com.br" style="color:#0f172a;font-weight:600;">www.vrashows.com.br</a></p>

<p style="margin:0 0 0;">Fico à disposição caso faça sentido conversarmos em algum momento.</p>`;

  return { subject, bodyText, bodyHtml };
}

// ─── Append to persistent log ─────────────────────────────────────────────────

interface LogEntry {
  company: string;
  contactName?: string | null;
  email: string;
  subject: string;
  status: string;
  resendId?: string | null;
  attachmentFile?: string | null;
  attachmentStatus: string;
  elapsed?: number;
  error?: string | null;
  sentAt: string;
}

function appendToLog(entry: LogEntry) {
  mkdirSync(LOGS_DIR, { recursive: true });
  const log = readJson<any>(LOG_FILE, {
    _meta: { description: "VRASHOWS institutional follow-up log (corrective with media kit)", updatedAt: "" },
    results: [],
  });
  log.results.push(entry);
  log._meta.updatedAt = new Date().toISOString();
  writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), "utf8");
}

// ─── Load contacts and build eligible list ────────────────────────────────────

const allContacts  = loadAllContacts();
const alreadySent  = loadAlreadySent();
const blocked      = loadBlocked();

const eligible = allContacts.filter((contact) => {
  if (blocked.has(contact.email)) return false;
  if (alreadySent.has(contact.email)) return false;
  return true;
});

// ─── Header ───────────────────────────────────────────────────────────────────

const modeLabel = TEST_MODE ? "TEST" : DRY_RUN ? "DRY-RUN" : "LIVE";
const attachLabel = ATTACH_PATH && !PREVIEW
  ? ATTACH_PATH.split(/[/\\]/).pop() ?? ATTACH_PATH
  : PREVIEW ? "(not checked in preview)" : "MISSING";

console.log(`\n${c.bold("VRASHOWS — Institutional Follow-up (Media Kit)")}`);
console.log(c.dim(`Mode: ${modeLabel}  ·  Campaign: vrashows-institutional-complement-2026`));
console.log(hr);
console.log(`  Total outbound base:     ${allContacts.length}`);
console.log(`  Already received:        ${alreadySent.size}`);
console.log(`  Blocked / bounced:       ${blocked.size}`);
console.log(`  Eligible this run:       ${eligible.length}`);
console.log(`  Batch:                   ${Math.min(eligible.length, LIMIT)} (limit: ${LIMIT})`);
console.log(`  Attachment:              ${attachLabel}`);
console.log(`  BCC:                     ${BCC ?? "none"}`);
console.log(`  Rate delay:              ${RATE_DELAY}ms`);
console.log(hr);

// ─── PREVIEW mode ─────────────────────────────────────────────────────────────

if (PREVIEW) {
  console.log(`\n${c.bold("ELIGIBLE CONTACTS")}\n`);
  for (const contact of eligible.slice(0, LIMIT)) {
    const { subject } = buildEmail(contact);
    console.log(`  ${c.bold((contact.contactName ?? "(no name)").padEnd(28))} → ${contact.email}`);
    console.log(`  ${c.dim("Company:")} ${contact.company}  ${c.dim("Sent:")} ${contact.sentAt.split("T")[0]}  ${c.dim("Source:")} ${contact.source}`);
    console.log(`  ${c.dim("Subject:")} ${subject}`);
    console.log();
  }
  console.log(`${c.cyan("Preview only — nothing sent.")}\n`);
  process.exit(0);
}

// ─── TEST mode ────────────────────────────────────────────────────────────────

if (TEST_MODE) {
  const sampleContact: ContactRecord = eligible[0] ?? {
    company: "Empresa Enterprise",
    contactName: "Contato Teste",
    email: TEST_EMAIL,
    sentAt: new Date().toISOString(),
    source: "test",
  };

  const { subject, bodyText, bodyHtml } = buildEmail(sampleContact);

  console.log(`\n${c.bold("TEST EMAIL")}\n`);
  console.log(`  ${c.dim("To:")}         ${TEST_EMAIL}`);
  console.log(`  ${c.dim("Sample:")}     ${sampleContact.contactName ?? "(no name)"} @ ${sampleContact.company}`);
  console.log(`  ${c.dim("Subject:")}    [TESTE] ${subject}`);
  console.log(`  ${c.dim("Attachment:")} ${ATTACH_PATH}`);
  console.log(`  ${c.dim("BCC:")}        ${BCC ?? "none"}`);
  console.log();

  console.log(`${c.bold("⚡ SENDING TEST EMAIL")} → ${TEST_EMAIL}\n`);

  const startMs = Date.now();
  const record = await sendEmail(
    {
      company: sampleContact.company,
      contactName: sampleContact.contactName ?? "Contato",
      recipientEmail: TEST_EMAIL,
      subject: `[TESTE] ${subject}`,
      bodyText,
      bodyHtml,
      emailType: "follow-up",
      sequenceNumber: 2,
      attachmentPath: ATTACH_PATH,
    },
    { dryRun: false, rateDelayMs: 0, bcc: BCC, deduplicationWindowDays: 0 }
  );

  const elapsed = Date.now() - startMs;
  const ok = record.status === "sent" || record.status === "queued";
  const statusColor = ok ? c.green : c.red;

  console.log(`  ${statusColor(record.status.toUpperCase().padEnd(8))} → ${TEST_EMAIL}  (${elapsed}ms)`);
  if (record.resendId) console.log(`  ${c.dim(`Resend ID: ${record.resendId}`)}`);
  if (record.error)    console.log(`  ${c.red(`Error: ${record.error}`)}`);

  console.log(`\n${hr}`);
  if (ok) {
    console.log(`\n  ${c.green("Test email sent.")}  Check ${c.bold(TEST_EMAIL)} for:\n`);
    console.log(`    ✓ HTML rendering and layout`);
    console.log(`    ✓ Official VRASHOWS signature`);
    console.log(`    ✓ PDF attachment: vrashows_media_kit_optimized.pdf`);
    console.log(`    ✓ Subject line and tone`);
    console.log(`    ✓ Branding and CTA`);
    console.log(`    ✓ Inbox placement (not spam)`);
    console.log(`\n  ${c.bold("After approval, run:")}`);
    console.log(`  ${c.cyan("npx tsx scripts/run-institutional-followup.ts --live --confirmed")}`);
    console.log(`\n  ${c.dim(`Eligible contacts: ${eligible.length}  ·  Estimated time: ~${Math.ceil(eligible.length * 3)} min`)}`);
  } else {
    console.log(`\n  ${c.red("Test failed.")} Check the error above before proceeding.\n`);
  }
  console.log(hr + "\n");
  process.exit(ok ? 0 : 1);
}

// ─── LIVE / DRY-RUN send loop ─────────────────────────────────────────────────

const batch = eligible.slice(0, LIMIT);

if (batch.length === 0) {
  console.log(`\n${c.green("All eligible contacts already received the institutional follow-up.")}\n`);
  process.exit(0);
}

const sessionStart = new Date().toISOString();
console.log(`\n${c.bold(DRY_RUN ? "DRY-RUN (staged)" : "⚡ LIVE SEND")}\n`);

let sentCount  = 0;
let failedCount = 0;
const sessionResults: any[] = [];

for (let i = 0; i < batch.length; i++) {
  const contact = batch[i]!;
  const { subject, bodyText, bodyHtml } = buildEmail(contact);
  const startMs = Date.now();

  try {
    const record = await sendEmail(
      {
        company: contact.company,
        contactName: contact.contactName ?? contact.company,
        recipientEmail: contact.email,
        subject,
        bodyText,
        bodyHtml,
        emailType: "follow-up",
        sequenceNumber: 2,
        attachmentPath: ATTACH_PATH,
      },
      { dryRun: DRY_RUN, rateDelayMs: RATE_DELAY, bcc: BCC, deduplicationWindowDays: 0 }
    );

    const elapsed = Date.now() - startMs;
    const ok = record.status === "sent" || record.status === "queued";
    if (ok) sentCount++; else failedCount++;

    const entry: LogEntry = {
      company: contact.company,
      contactName: contact.contactName ?? null,
      email: contact.email,
      subject,
      status: record.status,
      resendId: record.resendId ?? null,
      attachmentFile: ATTACH_PATH ? ATTACH_PATH.split(/[/\\]/).pop() ?? null : null,
      attachmentStatus: ATTACH_PATH ? "attached" : "missing",
      elapsed,
      error: record.error ?? null,
      sentAt: new Date().toISOString(),
    };

    sessionResults.push(entry);

    if (ok && !DRY_RUN) appendToLog(entry);

    const statusColor = ok ? c.green : c.red;
    console.log(`  ${statusColor(record.status.toUpperCase().padEnd(8))} ${c.bold((contact.contactName ?? contact.company).padEnd(28))} → ${contact.email}`);
    if (record.resendId) console.log(`           ${c.dim(`ID: ${record.resendId}  (${elapsed}ms)  📎 ${entry.attachmentFile ?? "no attachment"}`)}`);
    if (record.error)    console.log(`           ${c.red(`Error: ${record.error}`)}`);

  } catch (err) {
    const elapsed = Date.now() - startMs;
    const msg = err instanceof Error ? err.message : String(err);
    failedCount++;
    const entry: LogEntry = {
      company: contact.company,
      contactName: contact.contactName ?? null,
      email: contact.email,
      subject,
      status: "failed",
      attachmentStatus: "error",
      elapsed,
      error: msg,
      sentAt: new Date().toISOString(),
    };
    sessionResults.push(entry);
    console.log(`  ${c.red("FAILED  ")} ${c.bold(contact.contactName ?? contact.company)} → ${contact.email}`);
    console.log(`           ${c.red(`Error: ${msg}`)}`);
  }
}

// ─── Session report ───────────────────────────────────────────────────────────

const sessionEnd  = new Date().toISOString();
const reportFile  = resolve(OUTREACH_DIR, `institutional-followup-${sessionStart.replace(/[:.]/g, "-")}.json`);
mkdirSync(OUTREACH_DIR, { recursive: true });

writeFileSync(reportFile, JSON.stringify({
  sessionId:          `institutional-followup-${sessionStart}`,
  campaign:           "vrashows-institutional-complement-2026",
  mode:               DRY_RUN ? "dry-run" : "live",
  sessionStartedAt:   sessionStart,
  sessionCompletedAt: sessionEnd,
  totalAttempted:     batch.length,
  sent:               sentCount,
  failed:             failedCount,
  attachmentPath:     ATTACH_PATH ?? null,
  attachmentFile:     ATTACH_PATH ? ATTACH_PATH.split(/[/\\]/).pop() ?? null : null,
  bcc:                BCC ?? null,
  results:            sessionResults,
}, null, 2), "utf8");

console.log(`\n${hr}`);
console.log(`  ${c.bold("SESSION COMPLETE")}  [${DRY_RUN ? c.yellow("DRY-RUN") : c.green("LIVE")}]`);
console.log(`  Sent:       ${c.green(String(sentCount).padStart(3))}`);
console.log(`  Failed:     ${c.red(String(failedCount).padStart(3))}`);
console.log(`  Attachment: ${ATTACH_PATH ? c.green("✓ PDF included in every send") : c.red("✗ no attachment")}`);
console.log(`  Report:     ${reportFile}`);
console.log(hr + "\n");
