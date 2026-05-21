#!/usr/bin/env tsx
/**
 * followup-worker.ts - VRASHOWS controlled outbound follow-up worker.
 *
 * Sequence:
 *   - D+3: light follow-up
 *   - D+7: credibility / case
 *   - D+15: reopening
 *
 * Defaults to dry-run. Use --live to send via Resend.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const LOGS_DIR = resolve(ROOT, "logs");
const OUTREACH_LOGS_DIR = resolve(LOGS_DIR, "outreach");
const OUTBOUND_LOG_FILE = resolve(LOGS_DIR, "outbound-log.json");
const RESEND_LOG_FILE = resolve(LOGS_DIR, "resend-log.json");
const REPLIES_FILE = resolve(LOGS_DIR, "replies.json");
const FOLLOWUP_LOG_FILE = resolve(LOGS_DIR, "followup-log.json");

const MAX_FOLLOWUPS_PER_BATCH = 5;
const DEFAULT_RATE_DELAY_MS = 120000;
const BUSINESS_START = "09:00";
const BUSINESS_END = process.env.NO_SEND_AFTER || "16:00";
const WEEKEND_BLOCK = process.env.WEEKEND_BLOCK !== "false";
const OUTBOUND_RATE_DELAY_MS = Number(process.env.OUTBOUND_RATE_DELAY_MS ?? DEFAULT_RATE_DELAY_MS);
const OUTBOUND_BCC_EMAIL = process.env.OUTBOUND_BCC_EMAIL || undefined;
const MEDIA_KIT_PDF_PATH = process.env.MEDIA_KIT_PDF || undefined;
const SEND_EMAIL_MODULE = "../tools/send-email.js";

const PLAIN_TEXT_SIGNATURE = `\n--\nVRASHOWS\nOperações & Experiência Corporativa · VRASHOWS\nsamir.ricardo@vrashows.com.br | www.vrashows.com.br\nWhatsapp (11) 95357-7804`;

type FollowupStage = "d3-light" | "d7-credibility" | "d15-reopen";

interface FollowupOptions {
  live?: boolean;
  dryRun?: boolean;
  limit?: number;
  rateDelayMs?: number;
  maxRetries?: number;
  now?: Date;
  attachmentPath?: string;
}

interface SentRecord {
  company: string;
  email: string;
  contactName?: string;
  sentAt: string;
  source: string;
}

interface FollowupLogEntry {
  runId: string;
  mode: "dry-run" | "live";
  stage: FollowupStage;
  company: string;
  email: string;
  contactName: string;
  subject: string;
  status: "sent" | "staged" | "skipped" | "failed";
  resendId?: string | null;
  error?: string | null;
  initialSentAt: string;
  attemptedAt: string;
  sequenceNumber: number;
  attempts: number;
}

interface FollowupRunLog {
  runId: string;
  mode: "dry-run" | "live";
  startedAt: string;
  completedAt: string;
  eligible: number;
  attempted: number;
  sent: number;
  staged: number;
  failed: number;
  skipped: number;
  blockedReason?: string;
  results: FollowupLogEntry[];
}

interface FollowupLogFile {
  _meta: {
    description: string;
    updatedAt: string;
  };
  runs: FollowupRunLog[];
}

interface Candidate extends SentRecord {
  stage: FollowupStage;
  sequenceNumber: number;
  subject: string;
  bodyText: string;
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function normalizeEmail(email?: string | null) {
  return (email ?? "").trim().toLowerCase();
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(fromIso: string, to: Date) {
  const from = parseDate(fromIso);
  if (!from) return 0;
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

function parseClock(clock: string) {
  const [hours, minutes] = clock.split(":").map((part) => Number(part));
  return { hours: hours || 0, minutes: minutes || 0 };
}

function minutesSinceMidnight(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function businessWindowStatus(now: Date) {
  if (WEEKEND_BLOCK && isWeekend(now)) {
    return { allowed: false, reason: "weekend_block" };
  }

  const start = parseClock(BUSINESS_START);
  const end = parseClock(BUSINESS_END);
  const currentMinutes = minutesSinceMidnight(now);
  const startMinutes = start.hours * 60 + start.minutes;
  const endMinutes = end.hours * 60 + end.minutes;

  if (currentMinutes < startMinutes || currentMinutes > endMinutes) {
    return { allowed: false, reason: `outside_business_hours_${BUSINESS_START}-${BUSINESS_END}` };
  }

  return { allowed: true };
}

function loadOutboundRecords(): SentRecord[] {
  const records: SentRecord[] = [];
  const outbound = readJson<any[]>(OUTBOUND_LOG_FILE, []);

  for (const item of outbound) {
    if (item?.status !== "sent") continue;
    const email = normalizeEmail(item.email ?? item.recipientEmail ?? item.to);
    const sentAt = item.sentAt ?? item.date;
    if (!email || !sentAt) continue;
    records.push({
      company: String(item.company ?? "Unknown"),
      email,
      contactName: item.contactName ? String(item.contactName) : undefined,
      sentAt,
      source: "logs/outbound-log.json",
    });
  }

  if (existsSync(OUTREACH_LOGS_DIR)) {
    const files = readdirSync(OUTREACH_LOGS_DIR)
      .filter((file) => file.endsWith(".json"))
      .map((file) => ({ file, path: join(OUTREACH_LOGS_DIR, file), mtime: statSync(join(OUTREACH_LOGS_DIR, file)).mtime.getTime() }))
      .sort((a, b) => a.mtime - b.mtime);

    for (const { file, path } of files) {
      const session = readJson<any>(path, null);
      const results = Array.isArray(session?.results) ? session.results : [];
      for (const item of results) {
        if (item?.status !== "sent") continue;
        const email = normalizeEmail(item.recipientEmail ?? item.email ?? item.to);
        const sentAt = item.sentAt ?? session.sessionStartedAt;
        if (!email || !sentAt) continue;
        records.push({
          company: String(item.company ?? "Unknown"),
          email,
          contactName: item.contactName ? String(item.contactName) : undefined,
          sentAt,
          source: `logs/outreach/${file}`,
        });
      }
    }
  }

  const byEmail = new Map<string, SentRecord>();
  for (const record of records) {
    const existing = byEmail.get(record.email);
    if (!existing || new Date(record.sentAt).getTime() < new Date(existing.sentAt).getTime()) {
      byEmail.set(record.email, record);
    }
  }
  return [...byEmail.values()];
}

function loadBlockedEmails() {
  const replies = readJson<any[]>(REPLIES_FILE, []);
  const resend = readJson<any[]>(RESEND_LOG_FILE, []);
  const outbound = readJson<any[]>(OUTBOUND_LOG_FILE, []);
  const replyEmails = new Set<string>();
  const bouncedEmails = new Set<string>();
  const unsubscribeEmails = new Set<string>();

  for (const item of replies) {
    const email = normalizeEmail(item?.from ?? item?.email);
    if (!email) continue;
    const status = String(item?.status ?? "").toLowerCase();
    const subject = String(item?.subject ?? "").toLowerCase();
    const body = String(item?.body ?? item?.message ?? "").toLowerCase();
    if (status === "unsubscribe" || subject.includes("unsubscribe") || body.includes("unsubscribe") || body.includes("não receber")) {
      unsubscribeEmails.add(email);
    } else {
      replyEmails.add(email);
    }
  }

  for (const item of resend) {
    const email = normalizeEmail(item?.to ?? item?.email ?? item?.recipientEmail);
    const status = String(item?.status ?? "").toLowerCase();
    if (email && status.includes("bounce")) bouncedEmails.add(email);
    if (email && (status.includes("unsubscribe") || status.includes("complained"))) unsubscribeEmails.add(email);
  }

  for (const item of outbound) {
    const email = normalizeEmail(item?.email ?? item?.recipientEmail ?? item?.to);
    const status = String(item?.status ?? "").toLowerCase();
    if (email && status.includes("bounce")) bouncedEmails.add(email);
    if (email && status.includes("unsubscribe")) unsubscribeEmails.add(email);
  }

  if (existsSync(OUTREACH_LOGS_DIR)) {
    const files = readdirSync(OUTREACH_LOGS_DIR).filter((file) => file.endsWith(".json"));
    for (const file of files) {
      const deliveryLog = readJson<any>(join(OUTREACH_LOGS_DIR, file), null);
      const results = Array.isArray(deliveryLog?.results) ? deliveryLog.results : [];
      for (const item of results) {
        const email = normalizeEmail(item?.recipientEmail ?? item?.email ?? item?.to);
        const status = String(item?.status ?? "").toLowerCase();
        if (email && status.includes("bounce")) bouncedEmails.add(email);
        if (email && (status.includes("unsubscribe") || status.includes("complained"))) unsubscribeEmails.add(email);
        if (email && status === "replied") replyEmails.add(email);
      }
    }
  }

  return { replyEmails, bouncedEmails, unsubscribeEmails };
}

function loadFollowupLog(): FollowupLogFile {
  return readJson<FollowupLogFile>(FOLLOWUP_LOG_FILE, {
    _meta: {
      description: "VRASHOWS follow-up worker log",
      updatedAt: new Date().toISOString(),
    },
    runs: [],
  });
}

function saveFollowupLog(log: FollowupLogFile) {
  ensureDir(LOGS_DIR);
  log._meta.updatedAt = new Date().toISOString();
  writeFileSync(FOLLOWUP_LOG_FILE, JSON.stringify(log, null, 2), "utf8");
}

function completedStagesByEmail(log: FollowupLogFile) {
  const sent = new Map<string, Set<FollowupStage>>();
  for (const run of log.runs ?? []) {
    for (const result of run.results ?? []) {
      if (result.status !== "sent") continue;
      const email = normalizeEmail(result.email);
      if (!email) continue;
      const stages = sent.get(email) ?? new Set<FollowupStage>();
      stages.add(result.stage);
      sent.set(email, stages);
    }
  }
  return sent;
}

function buildFollowup(record: SentRecord, stage: FollowupStage): Candidate {
  const contactName = record.contactName || "tudo bem";
  const firstName = contactName === "tudo bem" ? "tudo bem" : contactName.trim().split(/\s+/)[0];

  if (stage === "d3-light") {
    return {
      ...record,
      stage,
      sequenceNumber: 2,
      subject: `Re: operação para eventos corporativos`,
      bodyText: `Olá ${firstName}, tudo bem?

Passando só para retomar meu contato anterior.

A VRASHOWS apoia marcas enterprise quando a operação do evento precisa funcionar sem ruído: montagem, recepção, credenciamento, backstage, equipe de apoio, ativações e suporte no dia.

Se eventos como Futurecom, feiras B2B ou encontros corporativos estiverem no radar da ${record.company}, posso te mostrar rapidamente como costumamos estruturar esse suporte.

Faz sentido conversarmos em algum momento desta semana?${PLAIN_TEXT_SIGNATURE}`,
    };
  }

  if (stage === "d7-credibility") {
    return {
      ...record,
      stage,
      sequenceNumber: 3,
      subject: `Referência para eventos enterprise`,
      bodyText: `Olá ${firstName}, tudo bem?

Um ponto que talvez seja útil: normalmente entramos quando o evento envolve várias frentes ao mesmo tempo, como stand, equipe de recepção, agenda executiva, fornecedores, brindes, ativações e atendimento ao público.

Nesses cenários, o valor está menos em "mais um fornecedor" e mais em ter uma operação centralizada, com padrão de marca e menos pontos soltos para o time interno administrar.

Se a ${record.company} estiver planejando Futurecom ou outro evento B2B de grande porte, posso compartilhar uma visão objetiva de como a VRASHOWS organiza esse tipo de operação.

Podemos falar por 15 minutos nos próximos dias?${PLAIN_TEXT_SIGNATURE}`,
    };
  }

  return {
    ...record,
    stage,
    sequenceNumber: 4,
    subject: `Retomo em outro momento?`,
    bodyText: `Olá ${firstName}, tudo bem?

Vou encerrar minha tentativa por aqui para não insistir fora de hora.

Achei que poderia fazer sentido falar com a ${record.company} porque a VRASHOWS costuma apoiar operações presenciais de maior complexidade: feiras, ativações de marca, eventos corporativos e experiências B2B com múltiplas equipes envolvidas.

Se esse tema ainda não estiver no radar, sem problema. Se fizer sentido para algum evento futuro, posso retomar com uma conversa curta e objetiva.

Devo procurar outra pessoa do time ou pauso por aqui?${PLAIN_TEXT_SIGNATURE}`,
  };
}

function selectCandidates(records: SentRecord[], log: FollowupLogFile, now: Date) {
  const blocked = loadBlockedEmails();
  const completed = completedStagesByEmail(log);
  const candidates: Candidate[] = [];

  for (const record of records) {
    if (blocked.replyEmails.has(record.email)) continue;
    if (blocked.bouncedEmails.has(record.email)) continue;
    if (blocked.unsubscribeEmails.has(record.email)) continue;

    const sentStages = completed.get(record.email) ?? new Set<FollowupStage>();
    const ageDays = daysBetween(record.sentAt, now);
    let stage: FollowupStage | null = null;

    if (ageDays >= 15 && !sentStages.has("d15-reopen")) {
      stage = "d15-reopen";
    } else if (ageDays >= 7 && !sentStages.has("d7-credibility")) {
      stage = "d7-credibility";
    } else if (ageDays >= 3 && !sentStages.has("d3-light")) {
      stage = "d3-light";
    }

    if (stage) candidates.push(buildFollowup(record, stage));
  }

  return candidates.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithRetry(candidate: Candidate, opts: FollowupOptions) {
  const maxRetries = opts.maxRetries ?? 2;
  let attempts = 0;
  let lastError: string | null = null;

  while (attempts <= maxRetries) {
    attempts += 1;
    if (opts.dryRun) {
      return { status: "staged" as const, resendId: null, error: null, attempts };
    }

    const { sendEmail } = (await import(SEND_EMAIL_MODULE)) as {
      sendEmail: (input: {
        company: string;
        contactName: string;
        recipientEmail: string;
        subject: string;
        bodyText: string;
        emailType: "follow-up" | "re-engagement";
        sequenceNumber: number;
        attachmentPath?: string;
      }, opts: {
        dryRun: boolean;
        rateDelayMs: number;
        bcc?: string;
        deduplicationWindowDays: number;
      }) => Promise<{ status: string; resendId?: string | null; error?: string | null }>;
    };

    const result = await sendEmail(
      {
        company: candidate.company,
        contactName: candidate.contactName || candidate.company,
        recipientEmail: candidate.email,
        subject: candidate.subject,
        bodyText: candidate.bodyText,
        emailType: candidate.stage === "d15-reopen" ? "re-engagement" : "follow-up",
        sequenceNumber: candidate.sequenceNumber,
        ...(opts.attachmentPath ? { attachmentPath: opts.attachmentPath } : {}),
      },
      {
        dryRun: false,
        rateDelayMs: 0,
        bcc: OUTBOUND_BCC_EMAIL,
        deduplicationWindowDays: 0,
      }
    );

    if (result.status === "sent") {
      return { status: "sent" as const, resendId: result.resendId ?? null, error: null, attempts };
    }

    lastError = result.error ?? `send returned ${result.status}`;
    if (attempts > maxRetries) break;
    await sleep(2000 * attempts);
  }

  return { status: "failed" as const, resendId: null, error: lastError ?? "retry exhausted", attempts };
}

export async function runFollowupWorker(opts: FollowupOptions = {}) {
  const now = opts.now ?? new Date();
  const live = opts.live ?? false;
  const dryRun = opts.dryRun ?? !live;
  const mode = dryRun ? "dry-run" : "live";
  const runId = `followup-${now.toISOString().replace(/[:.]/g, "-")}`;
  const startedAt = now.toISOString();
  const log = loadFollowupLog();
  const windowStatus = businessWindowStatus(now);

  if (!windowStatus.allowed) {
    const run: FollowupRunLog = {
      runId,
      mode,
      startedAt,
      completedAt: new Date().toISOString(),
      eligible: 0,
      attempted: 0,
      sent: 0,
      staged: 0,
      failed: 0,
      skipped: 0,
      blockedReason: windowStatus.reason,
      results: [],
    };
    log.runs.push(run);
    saveFollowupLog(log);
    console.log(`[followup-worker] Blocked: ${windowStatus.reason}. No follow-ups sent.`);
    return run;
  }

  const attachmentPath = opts.attachmentPath ?? MEDIA_KIT_PDF_PATH;

  if (!dryRun) {
    if (!attachmentPath) {
      console.error("[followup-worker] ABORTED — MEDIA_KIT_PDF not configured. Set MEDIA_KIT_PDF in .env.");
      process.exit(1);
    }
    if (!existsSync(attachmentPath)) {
      console.error(`[followup-worker] ABORTED — Media kit PDF not found: ${attachmentPath}`);
      process.exit(1);
    }
    console.log(`[followup-worker] PDF attachment validated: ${attachmentPath}`);
  }

  const records = loadOutboundRecords();
  const candidates = selectCandidates(records, log, now);
  const limit = Math.min(opts.limit ?? MAX_FOLLOWUPS_PER_BATCH, MAX_FOLLOWUPS_PER_BATCH);
  const batch = candidates.slice(0, limit);
  const results: FollowupLogEntry[] = [];

  console.log(`[followup-worker] Mode: ${mode}`);
  console.log(`[followup-worker] Eligible: ${candidates.length}. Processing up to ${batch.length}.`);

  for (let index = 0; index < batch.length; index += 1) {
    const candidate = batch[index]!;
    console.log(`[followup-worker] ${index + 1}/${batch.length}: ${candidate.company} -> ${candidate.email} (${candidate.stage})`);
    const result = await sendWithRetry(candidate, { ...opts, dryRun, live, attachmentPath });
    const attemptedAt = new Date().toISOString();

    results.push({
      runId,
      mode,
      stage: candidate.stage,
      company: candidate.company,
      email: candidate.email,
      contactName: candidate.contactName || candidate.company,
      subject: candidate.subject,
      status: result.status,
      resendId: result.resendId,
      error: result.error,
      initialSentAt: candidate.sentAt,
      attemptedAt,
      sequenceNumber: candidate.sequenceNumber,
      attempts: result.attempts,
    });

    if (index < batch.length - 1) {
      const delay = opts.rateDelayMs ?? OUTBOUND_RATE_DELAY_MS;
      if (delay > 0) {
        console.log(`[followup-worker] Waiting ${delay}ms before next follow-up...`);
        await sleep(delay);
      }
    }
  }

  const run: FollowupRunLog = {
    runId,
    mode,
    startedAt,
    completedAt: new Date().toISOString(),
    eligible: candidates.length,
    attempted: results.length,
    sent: results.filter((item) => item.status === "sent").length,
    staged: results.filter((item) => item.status === "staged").length,
    failed: results.filter((item) => item.status === "failed").length,
    skipped: Math.max(0, candidates.length - results.length),
    results,
  };

  log.runs.push(run);
  saveFollowupLog(log);
  console.log(`[followup-worker] Completed. Sent: ${run.sent}, Staged: ${run.staged}, Failed: ${run.failed}. Log: ${FOLLOWUP_LOG_FILE}`);
  return run;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(name);
  const val = (name: string) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };

  const live = flag("--live");
  const dryRun = !live;
  const limit = Number(val("--limit") ?? MAX_FOLLOWUPS_PER_BATCH);
  const rateDelayMs = Number(val("--rate-delay") ?? OUTBOUND_RATE_DELAY_MS);
  const maxRetries = Number(val("--retries") ?? 2);
  const nowArg = val("--now");
  const now = nowArg ? new Date(nowArg) : new Date();

  try {
    await runFollowupWorker({ live, dryRun, limit, rateDelayMs, maxRetries, now, attachmentPath: MEDIA_KIT_PDF_PATH });
  } catch (error) {
    console.error("[followup-worker] Unexpected failure:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (currentFile === process.argv[1]) {
  await main();
}
