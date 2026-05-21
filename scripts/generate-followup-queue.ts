#!/usr/bin/env tsx
/**
 * generate-followup-queue.ts — Build a premium follow-up outreach queue
 *
 * Reads all sent outreach logs, cross-references the followup-log and
 * blocked-contact lists, then outputs an OutreachQueue JSON file for
 * each eligible contact at the requested stage.
 *
 * Usage:
 *   tsx scripts/generate-followup-queue.ts --stage d3
 *   tsx scripts/generate-followup-queue.ts --stage d7
 *   tsx scripts/generate-followup-queue.ts --stage d15
 *   tsx scripts/generate-followup-queue.ts --stage auto   # all eligible stages
 *   tsx scripts/generate-followup-queue.ts --stage d3 --preview
 *   tsx scripts/generate-followup-queue.ts --stage d3 --now 2026-05-22T10:00:00Z
 *
 * Output: data/outreach/follow-up-{stage}-{YYYY-MM-DD}.json
 * Compatible with: tsx scripts/run-outbound-batch.ts --queue <file> --live --limit 5
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const LOGS_DIR = resolve(ROOT, "logs");
const OUTREACH_LOGS_DIR = resolve(LOGS_DIR, "outreach");
const OUTBOUND_LOG_FILE = resolve(LOGS_DIR, "outbound-log.json");
const FOLLOWUP_LOG_FILE = resolve(LOGS_DIR, "followup-log.json");
const RESEND_LOG_FILE = resolve(LOGS_DIR, "resend-log.json");
const REPLIES_FILE = resolve(LOGS_DIR, "replies.json");
const OUTPUT_DIR = resolve(ROOT, "data/outreach");

// ─── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const val = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };

type FollowupStage = "d3" | "d7" | "d15";
const STAGE_ARG = (val("--stage") ?? "auto") as FollowupStage | "auto";
const PREVIEW = flag("--preview") || flag("--dry-run");
const NOW_ARG = val("--now");
const NOW = NOW_ARG ? new Date(NOW_ARG) : new Date();
const TARGET_EVENT = val("--event") ?? "Futurecom 2026";
const CAMPAIGN = val("--campaign") ?? "futurecom-2026-followup-v1";
const ATTACH_PATH = process.env.MEDIA_KIT_PDF || "";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")) as T; }
  catch { return fallback; }
}

function normalizeEmail(email?: string | null) {
  return (email ?? "").trim().toLowerCase();
}

function daysBetween(fromIso: string, to: Date) {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return 0;
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

function firstName(fullName?: string | null): string {
  if (!fullName || fullName.trim().length === 0) return "";
  return fullName.trim().split(/\s+/)[0]!;
}

function uid(): string {
  return crypto.randomBytes(6).toString("hex");
}

// ─── Segment detection ────────────────────────────────────────────────────────

type Segment = "telecom" | "cloud" | "fintech" | "ai-sec" | "marketing" | "enterprise";

const TELECOM_KEYWORDS = ["claro", "vivo", "tim", "ericsson", "nokia", "huawei", "embratel", "v.tal", "vtal", "oi ", "intelig", "telefonica", "telefônica", "telecom", "anatel", "nextel"];
const CLOUD_KEYWORDS = ["aws", "amazon", "azure", "microsoft", "google", "oracle", "ibm", "vmware", "salesforce", "sap"];
const FINTECH_KEYWORDS = ["banco", "bank", "pagbank", "nubank", "itau", "bradesco", "santander", "finance", "credito", "credit", "btg", "xp", "inter"];
const AISEC_KEYWORDS = ["cisco", "fortinet", "palo alto", "crowdstrike", "sentinelone", "ai ", "inteligência", "security", "segurança", "cyber"];

function detectSegment(company: string): Segment {
  const c = company.toLowerCase();
  if (TELECOM_KEYWORDS.some((k) => c.includes(k))) return "telecom";
  if (CLOUD_KEYWORDS.some((k) => c.includes(k))) return "cloud";
  if (FINTECH_KEYWORDS.some((k) => c.includes(k))) return "fintech";
  if (AISEC_KEYWORDS.some((k) => c.includes(k))) return "ai-sec";
  return "enterprise";
}

// ─── Segment personalizations ─────────────────────────────────────────────────

type SegmentLines = Record<Segment, string>;

const D3_SEGMENT_LINE: SegmentLines = {
  telecom:    "especialmente considerando a complexidade de stands com demos 5G e múltiplas equipes simultâneas.",
  cloud:      "garantir que a experiência no evento reflita o padrão de excelência que a [Empresa] entrega digitalmente.",
  fintech:    "criar uma experiência no evento que reflita a solidez institucional que os clientes e parceiros da [Empresa] esperam.",
  "ai-sec":   "manter o ambiente do evento controlado e de alta confiança — sem espaço para ruído operacional.",
  marketing:  "ativações de marca sem ruído operacional — para que a experiência brilhe na frente, não nos bastidores.",
  enterprise: "garantir que a presença no evento transmita o padrão que os stakeholders da [Empresa] esperam.",
};

const D7_SEGMENT_LINE: SegmentLines = {
  telecom:    "considerando a complexidade de stands com demos técnicos, múltiplas equipes e presença C-level simultânea que eventos como o Futurecom exigem.",
  cloud:      "considerando que experiências enterprise bem executadas constroem percepção de marca com a mesma força que campanhas digitais.",
  fintech:    "considerando o padrão de hospitalidade e rigor operacional que marcas financeiras enterprise precisam entregar para parceiros e clientes no evento.",
  "ai-sec":   "considerando que ambientes de demo técnico e briefings executivos exigem controle operacional preciso — sem improvisos visíveis.",
  marketing:  "considerando que a experiência no estande é, em si, uma extensão da marca — e precisa ser invisível nos bastidores para brilhar na frente.",
  enterprise: "considerando que operações de evento enterprise com múltiplas frentes exigem um coordenador único e experiente.",
};

// ─── Premium HTML templates ───────────────────────────────────────────────────

const BASE_SIGNATURE = `<table cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;border-top:1px solid #e2e8f0;padding-top:20px;width:100%;">
  <tr>
    <td>
      <p style="margin:0;font-size:13px;font-weight:700;color:#0f172a;letter-spacing:0.3px;">VRASHOWS</p>
      <p style="margin:2px 0 0;font-size:11px;color:#64748b;">Operações &amp; Experiência Corporativa · VRASHOWS</p>
      <p style="margin:4px 0 0;font-size:11px;">
        <a href="mailto:samir.ricardo@vrashows.com.br" style="color:#2563eb;text-decoration:none;">samir.ricardo@vrashows.com.br</a>
      </p>
      <p style="margin:2px 0 0;font-size:11px;">
        <a href="https://www.vrashows.com.br" style="color:#0f172a;text-decoration:none;font-weight:600;">www.vrashows.com.br</a>
      </p>
      <p style="margin:2px 0 0;font-size:11px;color:#64748b;">Whatsapp (11) 95357-7804</p>
    </td>
  </tr>
</table>`;

const PLAIN_TEXT_SIG = `\n--\nVRASHOWS\nOperações & Experiência Corporativa · VRASHOWS\nsamir.ricardo@vrashows.com.br | www.vrashows.com.br\nWhatsapp (11) 95357-7804`;

const CTA_BUTTON = `<p style="margin:24px 0 0;">
  <a href="https://vrashows.com.br"
     style="display:inline-block;background:#0f172a;color:#ffffff;font-size:12px;font-weight:600;
            padding:9px 20px;border-radius:4px;text-decoration:none;letter-spacing:0.3px;">
    Vamos conversar &rarr;
  </a>
</p>`;

const CTA_LINK_ONLY = `<p style="margin:24px 0 0;font-size:13px;color:#475569;">
  <a href="https://vrashows.com.br" style="color:#0f172a;text-decoration:none;font-weight:600;">vrashows.com.br</a>
</p>`;

function wrapEmail(body: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#ffffff;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;padding:32px 24px 40px;">
    <tr><td style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.65;color:#1e293b;">
      ${body}
      ${BASE_SIGNATURE}
    </td></tr>
  </table>
</body>
</html>`;
}

interface ContactRecord {
  company: string;
  contactName?: string;
  email: string;
  originalSubject?: string;
  sentAt: string;
  qualityScore?: number;
  outreachPriority?: number;
  source: string;
}

function buildD3Html(contact: ContactRecord, segment: Segment): { subject: string; bodyText: string; bodyHtml: string } {
  const name = firstName(contact.contactName);
  const greeting = name ? `${name},` : "Olá,";
  const segLine = D3_SEGMENT_LINE[segment]
    .replace("[Empresa]", contact.company)
    .replace("[Evento]", TARGET_EVENT);
  const company = contact.company;
  const reSubject = contact.originalSubject
    ? `Re: ${contact.originalSubject}`
    : `Re: operação enterprise para o ${TARGET_EVENT}`;

  const bodyText = `${greeting}

Só queria garantir que meu email anterior chegou — às vezes fica no filtro de promoções.

Caso não tenha tido oportunidade de ver o material, estou à disposição para uma conversa rápida sobre como a VRASHOWS pode apoiar a operação da ${company} no ${TARGET_EVENT} — ${segLine}

Sem urgência — só deixo aberto caso faça sentido neste momento.${PLAIN_TEXT_SIG}`;

  const bodyHtml = wrapEmail(`<p>${greeting}</p>

<p>Só queria garantir que meu email anterior chegou — às vezes fica no filtro de promoções.</p>

<p>Caso não tenha tido oportunidade de ver o material, estou à disposição para uma conversa rápida sobre como a VRASHOWS pode apoiar a operação da <strong>${company}</strong> no ${TARGET_EVENT} — ${segLine}</p>

<p>Sem urgência — só deixo aberto caso faça sentido neste momento.</p>

${CTA_BUTTON}`);

  return { subject: reSubject, bodyText, bodyHtml };
}

function buildD7Html(contact: ContactRecord, segment: Segment): { subject: string; bodyText: string; bodyHtml: string } {
  const name = firstName(contact.contactName);
  const greeting = name ? `${name},` : "Olá,";
  const segLine = D7_SEGMENT_LINE[segment]
    .replace("[Empresa]", contact.company)
    .replace("[Evento]", TARGET_EVENT);
  const company = contact.company;

  const bodyText = `${greeting}

Quero compartilhar algo que pode ser útil.

Na ABRINT 2026, estruturamos toda a operação para a Brasil TecPar — staff premium, logística, hospitality e suporte em tempo real. O resultado foi uma presença de alto padrão com zero ruído operacional para o time interno, que ficou 100% focado em negócios.

Acredito que esse modelo faz sentido para o que a ${company} planeja para o ${TARGET_EVENT} — ${segLine}

Se quiser, posso detalhar como adaptaríamos essa estrutura para vocês.${PLAIN_TEXT_SIG}`;

  const bodyHtml = wrapEmail(`<p>${greeting}</p>

<p>Quero compartilhar algo que pode ser útil.</p>

<p>Na ABRINT 2026, estruturamos toda a operação para a Brasil TecPar — staff premium, logística, hospitality e suporte em tempo real. O resultado foi uma presença de alto padrão com <strong>zero ruído operacional</strong> para o time interno, que ficou 100% focado em negócios.</p>

<p>Acredito que esse modelo faz sentido para o que a <strong>${company}</strong> planeja para o ${TARGET_EVENT} — ${segLine}</p>

<p>Se quiser, posso detalhar como adaptaríamos essa estrutura para vocês.</p>

${CTA_BUTTON}`);

  return { subject: `Como estruturamos a operação na ABRINT 2026`, bodyText, bodyHtml };
}

function buildD15Html(contact: ContactRecord): { subject: string; bodyText: string; bodyHtml: string } {
  const name = firstName(contact.contactName);
  const greeting = name ? `${name},` : "Olá,";
  const company = contact.company;

  const bodyText = `${greeting}

Respeito totalmente que o momento pode não ser agora.

Quando o planejamento para o ${TARGET_EVENT} ou o próximo ciclo de eventos da ${company} avançar, fico à disposição — esse é exatamente o momento em que uma conversa faz mais sentido: antes da pressão operacional do evento.

Até lá, qualquer dúvida sobre operação enterprise é só acionar.${PLAIN_TEXT_SIG}`;

  const bodyHtml = wrapEmail(`<p>${greeting}</p>

<p>Respeito totalmente que o momento pode não ser agora.</p>

<p>Quando o planejamento para o ${TARGET_EVENT} ou o próximo ciclo de eventos da <strong>${company}</strong> avançar, fico à disposição — esse é exatamente o momento em que uma conversa faz mais sentido: <em>antes da pressão operacional do evento</em>.</p>

<p>Até lá, qualquer dúvida sobre operação enterprise é só acionar.</p>

${CTA_LINK_ONLY}`);

  return { subject: `${company} — quando o momento for certo`, bodyText, bodyHtml };
}

// ─── Load sent records ────────────────────────────────────────────────────────

function loadSentRecords(): ContactRecord[] {
  const byEmail = new Map<string, ContactRecord>();

  const outbound = readJson<any[]>(OUTBOUND_LOG_FILE, []);
  for (const item of outbound) {
    if (item?.status !== "sent") continue;
    const email = normalizeEmail(item.email ?? item.recipientEmail ?? item.to);
    const sentAt = item.sentAt ?? item.date;
    if (!email || !sentAt) continue;
    const existing = byEmail.get(email);
    if (!existing || new Date(sentAt) < new Date(existing.sentAt)) {
      byEmail.set(email, {
        company: String(item.company ?? ""),
        email,
        sentAt,
        source: "logs/outbound-log.json",
      });
    }
  }

  if (existsSync(OUTREACH_LOGS_DIR)) {
    const files = readdirSync(OUTREACH_LOGS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ f, path: join(OUTREACH_LOGS_DIR, f), mtime: statSync(join(OUTREACH_LOGS_DIR, f)).mtime.getTime() }))
      .sort((a, b) => a.mtime - b.mtime);

    for (const { f, path } of files) {
      const session = readJson<any>(path, null);
      const results: any[] = Array.isArray(session?.results) ? session.results : [];
      for (const item of results) {
        if (item?.status !== "sent") continue;
        const email = normalizeEmail(item.recipientEmail ?? item.email ?? item.to);
        const sentAt = item.sentAt ?? session.sessionStartedAt;
        if (!email || !sentAt) continue;
        const existing = byEmail.get(email);
        if (!existing || new Date(sentAt) < new Date(existing.sentAt)) {
          byEmail.set(email, {
            company: String(item.company ?? existing?.company ?? ""),
            contactName: item.contactName ? String(item.contactName) : existing?.contactName,
            email,
            originalSubject: item.subject ? String(item.subject) : existing?.originalSubject,
            sentAt,
            qualityScore: typeof item.qualityScore === "number" ? item.qualityScore : existing?.qualityScore,
            outreachPriority: typeof item.outreachPriority === "number" ? item.outreachPriority : existing?.outreachPriority,
            source: `logs/outreach/${f}`,
          });
        } else if (existing && (!existing.contactName || !existing.originalSubject)) {
          if (!existing.contactName && item.contactName) existing.contactName = String(item.contactName);
          if (!existing.originalSubject && item.subject) existing.originalSubject = String(item.subject);
          if (!existing.qualityScore && typeof item.qualityScore === "number") existing.qualityScore = item.qualityScore;
          if (!existing.outreachPriority && typeof item.outreachPriority === "number") existing.outreachPriority = item.outreachPriority;
        }
      }
    }
  }

  return [...byEmail.values()];
}

// ─── Load blocked / completed ─────────────────────────────────────────────────

function loadBlockedEmails(): Set<string> {
  const blocked = new Set<string>();

  const replies = readJson<any[]>(REPLIES_FILE, []);
  for (const item of replies) {
    const email = normalizeEmail(item?.from ?? item?.email);
    if (email) blocked.add(email);
  }

  const resend = readJson<any[]>(RESEND_LOG_FILE, []);
  for (const item of resend) {
    const email = normalizeEmail(item?.to ?? item?.email ?? item?.recipientEmail);
    const status = String(item?.status ?? "").toLowerCase();
    if (email && (status.includes("bounce") || status.includes("unsubscribe") || status.includes("complained"))) {
      blocked.add(email);
    }
  }

  const outbound = readJson<any[]>(OUTBOUND_LOG_FILE, []);
  for (const item of outbound) {
    const email = normalizeEmail(item?.email ?? item?.recipientEmail ?? item?.to);
    const status = String(item?.status ?? "").toLowerCase();
    if (email && (status.includes("bounce") || status.includes("unsubscribe"))) blocked.add(email);
  }

  return blocked;
}

function loadCompletedStages(): Map<string, Set<FollowupStage>> {
  const completed = new Map<string, Set<FollowupStage>>();
  const log = readJson<any>(FOLLOWUP_LOG_FILE, { runs: [] });

  for (const run of log.runs ?? []) {
    for (const result of run.results ?? []) {
      if (result.status !== "sent") continue;
      const email = normalizeEmail(result.email);
      if (!email) continue;
      const rawStage = String(result.stage ?? "");
      const stage: FollowupStage | null =
        rawStage.startsWith("d3") ? "d3" :
        rawStage.startsWith("d7") ? "d7" :
        rawStage.startsWith("d15") ? "d15" : null;
      if (!stage) continue;
      const stages = completed.get(email) ?? new Set<FollowupStage>();
      stages.add(stage);
      completed.set(email, stages);
    }
  }
  return completed;
}

// ─── Stage selection ──────────────────────────────────────────────────────────

function eligibleStage(
  record: ContactRecord,
  completedStages: Set<FollowupStage>,
  requestedStage: FollowupStage | "auto",
  now: Date
): FollowupStage | null {
  const days = daysBetween(record.sentAt, now);

  if (requestedStage === "auto") {
    if (days >= 15 && !completedStages.has("d15")) return "d15";
    if (days >= 7 && !completedStages.has("d7")) return "d7";
    if (days >= 3 && !completedStages.has("d3")) return "d3";
    return null;
  }

  const minDays = requestedStage === "d3" ? 3 : requestedStage === "d7" ? 7 : 15;
  if (days < minDays) return null;
  if (completedStages.has(requestedStage)) return null;
  return requestedStage;
}

// ─── Build queue entries ──────────────────────────────────────────────────────

interface QueueEntry {
  id: string;
  priority: "HOT" | "WARM";
  lead: {
    company: string;
    contactName: string;
    role: string;
    linkedin: string;
    area: string;
    seniority: string;
    guessedEmails: Array<{ email: string; pattern: string; confidence: string }>;
    primaryEmail: string;
    confidence: "high" | "medium" | "low";
    bounceRisk: "low" | "medium" | "high";
    relevanceScore: number;
    strategicFitScore: number;
    outreachPriority: number;
    strategicFit: "excellent" | "strong" | "moderate" | "weak";
    rationale: string;
    recommendedTemplate: string;
    recommendedApproach: string;
    recommendedCTA: string;
    useCaseABRINT: boolean;
    personalizationLevel: "high" | "medium" | "standard";
    status: "HOT" | "WARM";
    campaignId: string;
    targetEvent: string;
    validatedAt: string;
    originalPriorityScore?: number;
  };
  email: {
    to: string;
    subject: string;
    bodyText: string;
    bodyHtml: string;
    attachmentPath?: string;
  };
  quality: {
    score: number;
    decision: "send" | "review" | "skip";
    flags: string[];
    suggestions: string[];
  };
  status: "queued";
  followUpStage: FollowupStage;
  originalSentAt: string;
  segment: Segment;
}

function buildEntry(record: ContactRecord, stage: FollowupStage): QueueEntry {
  const segment = detectSegment(record.company);
  const priority = (record.outreachPriority ?? record.qualityScore ?? 75) >= 85 ? "HOT" : "WARM";
  const qualityScore = record.qualityScore ?? 75;

  let emailContent: { subject: string; bodyText: string; bodyHtml: string };
  if (stage === "d3") emailContent = buildD3Html(record, segment);
  else if (stage === "d7") emailContent = buildD7Html(record, segment);
  else emailContent = buildD15Html(record);

  const outreachPriority = record.outreachPriority ?? qualityScore;

  return {
    id: `follow-${stage}-${uid()}`,
    priority,
    lead: {
      company: record.company,
      contactName: record.contactName ?? record.company,
      role: "",
      linkedin: "",
      area: "Enterprise Events",
      seniority: "executive",
      guessedEmails: [{ email: record.email, pattern: "known", confidence: "high" }],
      primaryEmail: record.email,
      confidence: "high",
      bounceRisk: "low",
      relevanceScore: outreachPriority,
      strategicFitScore: outreachPriority,
      outreachPriority,
      strategicFit: outreachPriority >= 90 ? "excellent" : outreachPriority >= 80 ? "strong" : "moderate",
      rationale: `Follow-up ${stage.toUpperCase()} — cold outreach sent ${record.sentAt.split("T")[0]}`,
      recommendedTemplate: stage === "d15" ? "executive-intro" : "cold-outreach",
      recommendedApproach: `Follow-up sequence ${stage.toUpperCase()} via premium template`,
      recommendedCTA: stage === "d15" ? "Link only — no pressure" : "Schedule conversation",
      useCaseABRINT: stage === "d7",
      personalizationLevel: "high",
      status: priority,
      campaignId: CAMPAIGN,
      targetEvent: TARGET_EVENT,
      validatedAt: new Date().toISOString(),
    },
    email: {
      to: record.email,
      ...emailContent,
      ...(ATTACH_PATH ? { attachmentPath: ATTACH_PATH } : {}),
    },
    quality: {
      score: qualityScore,
      decision: qualityScore >= 70 ? "send" : "review",
      flags: [],
      suggestions: [],
    },
    status: "queued",
    followUpStage: stage,
    originalSentAt: record.sentAt,
    segment,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  bold:   (s: string) => USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s,
  dim:    (s: string) => USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s,
  green:  (s: string) => USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s,
  yellow: (s: string) => USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s,
  red:    (s: string) => USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s,
  cyan:   (s: string) => USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s,
};

const hr = "═".repeat(68);
console.log(`\n${c.bold("VRASHOWS — Follow-up Queue Generator")}`);
console.log(c.dim(`Stage: ${STAGE_ARG} · Ref date: ${NOW.toISOString().split("T")[0]} · Campaign: ${CAMPAIGN}`));
console.log(hr);

const sentRecords = loadSentRecords();
const blocked = loadBlockedEmails();
const completedStagesByEmail = loadCompletedStages();

console.log(`${c.dim("Sent records loaded:")} ${sentRecords.length}`);
console.log(`${c.dim("Blocked contacts:")}    ${blocked.size}`);

const entries: QueueEntry[] = [];
const skippedBlocked: string[] = [];
const skippedTooEarly: string[] = [];
const skippedAlreadyDone: string[] = [];

for (const record of sentRecords) {
  if (blocked.has(record.email)) {
    skippedBlocked.push(record.email);
    continue;
  }

  const completedStages = completedStagesByEmail.get(record.email) ?? new Set<FollowupStage>();
  const stage = eligibleStage(record, completedStages, STAGE_ARG, NOW);

  if (!stage) {
    const days = daysBetween(record.sentAt, NOW);
    const minDays = STAGE_ARG === "d3" ? 3 : STAGE_ARG === "d7" ? 7 : STAGE_ARG === "d15" ? 15 : 3;
    if (days < minDays) {
      skippedTooEarly.push(`${record.email} (D+${days})`);
    } else {
      skippedAlreadyDone.push(record.email);
    }
    continue;
  }

  entries.push(buildEntry(record, stage));
}

entries.sort((a, b) => b.lead.outreachPriority - a.lead.outreachPriority);

const hotCount = entries.filter((e) => e.priority === "HOT").length;
const warmCount = entries.filter((e) => e.priority === "WARM").length;
const avgQuality = entries.length > 0
  ? Math.round(entries.reduce((sum, e) => sum + e.quality.score, 0) / entries.length)
  : 0;

console.log(`\n${c.bold("ELIGIBLE CONTACTS")}\n`);

for (const entry of entries) {
  const prioColor = entry.priority === "HOT" ? c.green : c.yellow;
  console.log(`  ${prioColor(`[${entry.priority}]`)} ${c.bold((entry.lead.contactName || entry.lead.company).padEnd(28))} → ${entry.email.to}`);
  console.log(`  ${c.dim("Stage:")} ${entry.followUpStage.toUpperCase()}  ${c.dim("Segment:")} ${entry.segment}  ${c.dim("Q:")} ${entry.quality.score}  ${c.dim("Original:")} ${entry.originalSentAt.split("T")[0]}`);
  console.log(`  ${c.dim("Subject:")} ${entry.email.subject}`);
  console.log();
}

if (skippedBlocked.length > 0)  console.log(c.dim(`Skipped (blocked):     ${skippedBlocked.length}`));
if (skippedTooEarly.length > 0) console.log(c.dim(`Skipped (too early):   ${skippedTooEarly.length}`));
if (skippedAlreadyDone.length > 0) console.log(c.dim(`Skipped (done):        ${skippedAlreadyDone.length}`));

console.log(`\n${hr}`);
console.log(`  ${c.bold("Total eligible:")} ${entries.length}  (HOT: ${hotCount} · WARM: ${warmCount} · Avg quality: ${avgQuality})`);

if (entries.length === 0) {
  console.log(`\n${c.yellow("No eligible contacts found for this stage / date combination.")}`);
  if (STAGE_ARG !== "auto") {
    const minDays = STAGE_ARG === "d3" ? 3 : STAGE_ARG === "d7" ? 7 : 15;
    console.log(c.dim(`  Tip: Cold outreach must be at least ${minDays} days old for ${STAGE_ARG.toUpperCase()}.`));
    const oldest = sentRecords.reduce<string | null>((min, r) => (!min || r.sentAt < min ? r.sentAt : min), null);
    if (oldest) {
      const ready = new Date(oldest);
      ready.setDate(ready.getDate() + minDays);
      console.log(c.dim(`  Earliest eligible date: ${ready.toISOString().split("T")[0]}`));
    }
  }
  console.log();
  process.exit(0);
}

if (PREVIEW) {
  console.log(`\n${c.cyan("Preview mode — queue not saved.")}\n`);
  process.exit(0);
}

// ─── Save queue ───────────────────────────────────────────────────────────────

mkdirSync(OUTPUT_DIR, { recursive: true });

const datestamp = NOW.toISOString().split("T")[0];
const stageLabel = STAGE_ARG === "auto" ? "multi" : STAGE_ARG;
const outputFile = resolve(OUTPUT_DIR, `follow-up-${stageLabel}-${datestamp}.json`);

const queue = {
  queueId: `followup-${stageLabel}-${Date.now()}`,
  generatedAt: NOW.toISOString(),
  campaign: CAMPAIGN,
  targetEvent: TARGET_EVENT,
  followupStage: STAGE_ARG,
  attachmentPath: ATTACH_PATH,
  totalEntries: entries.length,
  hotCount,
  warmCount,
  avgQualityScore: avgQuality,
  entries,
};

writeFileSync(outputFile, JSON.stringify(queue, null, 2), "utf8");

console.log(`\n  ${c.green("Queue saved:")} ${outputFile}`);
console.log(`\n  ${c.bold("Next step:")}`);
console.log(`  ${c.cyan("tsx scripts/run-outbound-batch.ts --queue")} ${outputFile.replace(ROOT + "/", "data/outreach/").replace(ROOT + "\\", "data/outreach/")} ${c.cyan("--dry-run")}`);
console.log(`  ${c.cyan("tsx scripts/run-outbound-batch.ts --queue")} ${outputFile.replace(ROOT + "/", "data/outreach/").replace(ROOT + "\\", "data/outreach/")} ${c.cyan("--live --limit 5")}`);
console.log(hr + "\n");
