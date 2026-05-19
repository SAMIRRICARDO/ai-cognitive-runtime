#!/usr/bin/env tsx
/**
 * delivery-worker.ts — VRASHOWS outbound delivery worker.
 *
 * Goals:
 *   - send up to MAX_BATCH_SIZE emails per run
 *   - human-style spacing between sends
 *   - simple throttling and retry caps
 *   - graceful failure and log output
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { dirname, resolve, join } from "path";
import { fileURLToPath } from "url";
import { sendEmail } from "../tools/send-email.js";
import { env } from "../config/env.js";
import type { OutreachQueue, OutreachQueueEntry } from "../agents/outreach-builder/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUTREACH_DIR = resolve(ROOT, "data/outreach");
const STATE_FILE = resolve(ROOT, "data/outbound/delivery-state.json");
const LOG_DIR = resolve(ROOT, "logs/outreach");

interface DeliveryOptions {
  queuePath?: string;
  limit?: number;
  live?: boolean;
  dryRun?: boolean;
  rateDelayMs?: number;
  maxRetries?: number;
}

interface DeliveryState {
  date: string;
  sentToday: number;
}

function formatTime(date: Date) {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

function loadState(): DeliveryState {
  const today = new Date().toISOString().slice(0, 10);

  if (!existsSync(STATE_FILE)) {
    return { date: today, sentToday: 0 };
  }

  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    if (raw?.date !== today) return { date: today, sentToday: 0 };
    return { date: raw.date, sentToday: Number(raw.sentToday) || 0 };
  } catch {
    return { date: today, sentToday: 0 };
  }
}

function saveState(state: DeliveryState) {
  ensureDir(resolve(STATE_FILE, ".."));
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function resolveQueueFile(queueArg?: string): string {
  if (queueArg) return resolve(ROOT, queueArg);
  if (!existsSync(OUTREACH_DIR)) {
    throw new Error(`Outreach directory not found: ${OUTREACH_DIR}`);
  }
  const files = readdirSync(OUTREACH_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({ file, path: join(OUTREACH_DIR, file), mtime: statSync(join(OUTREACH_DIR, file)).mtime.getTime() }))
    .sort((a, b) => b.mtime - a.mtime);
  if (files.length === 0) {
    throw new Error(`No queue files found in ${OUTREACH_DIR}`);
  }
  return files[0].path;
}

function loadQueue(queuePath: string): OutreachQueue {
  const raw = readFileSync(queuePath, "utf8");
  return JSON.parse(raw) as OutreachQueue;
}

function saveQueue(queuePath: string, queue: OutreachQueue) {
  writeFileSync(queuePath, JSON.stringify(queue, null, 2), "utf8");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendEntry(entry: OutreachQueueEntry, opts: DeliveryOptions) {
  const retryDelay = 2000;
  const maxRetries = opts.maxRetries ?? 2;
  let attempt = 0;

  while (attempt <= maxRetries) {
    attempt += 1;
    const result = await sendEmail(
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
      {
        dryRun: opts.dryRun ?? true,
        rateDelayMs: 0,
        bcc: env.OUTBOUND_BCC_EMAIL ?? undefined,
      }
    );

    if (result.status === "sent" || result.status === "queued") {
      return { status: result.status, resendId: result.resendId ?? null, error: result.error ?? null, sentAt: result.sentAt };
    }

    if (attempt > maxRetries) {
      return { status: result.status, resendId: result.resendId ?? null, error: result.error ?? "unknown error", sentAt: result.sentAt };
    }

    await sleep(retryDelay * attempt);
  }

  return { status: "failed", resendId: null, error: "retry exhausted", sentAt: new Date().toISOString() };
}

export async function runDeliveryWorker(opts: DeliveryOptions = {}) {
  const queuePath = resolveQueueFile(opts.queuePath);
  const queue = loadQueue(queuePath);

  const state = loadState();
  const dailyLimit = opts.limit ?? Math.min(env.MAX_BATCH_SIZE, env.MAX_SENDS_PER_DAY);
  const remainingToday = Math.max(0, env.MAX_SENDS_PER_DAY - state.sentToday);
  const effectiveLimit = Math.min(dailyLimit, remainingToday);

  if (effectiveLimit <= 0) {
    console.log(`[delivery-worker] Daily send limit reached (${state.sentToday}/${env.MAX_SENDS_PER_DAY}). No sends performed.`);
    return { queuePath, queue, sent: 0, failed: 0, updated: false };
  }

  const queuedEntries = queue.entries.filter((entry) => entry.status === "queued");
  if (queuedEntries.length === 0) {
    console.log(`[delivery-worker] No queued entries available in ${queuePath}. Nothing to send.`);
    return { queuePath, queue, sent: 0, failed: 0, updated: false };
  }

  const batchSize = Math.min(effectiveLimit, opts.limit ?? env.MAX_BATCH_SIZE, queuedEntries.length);
  const entries = queuedEntries.slice(0, batchSize);

  console.log(`[delivery-worker] Loading queue: ${queuePath}`);
  console.log(`[delivery-worker] Mode: ${opts.dryRun ? "dry-run" : "live"}`);
  console.log(`[delivery-worker] Daily limit: ${env.MAX_SENDS_PER_DAY}, already sent today: ${state.sentToday}`);
  console.log(`[delivery-worker] Sending up to ${batchSize} entries with ${opts.rateDelayMs ?? 120000}ms spacing.`);

  let sentCount = 0;
  let failedCount = 0;
  let updated = false;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    console.log(`\n[delivery-worker] Processing ${index + 1}/${batchSize}: ${entry.lead.company} → ${entry.email.to}`);

    const result = await sendEntry(entry, opts);
    entry.status = result.status === "sent" || result.status === "queued" ? result.status : "failed";
    entry.sentAt = result.sentAt ?? new Date().toISOString();
    entry.resendId = result.resendId ?? undefined;
    entry.error = result.error ?? undefined;

    if (entry.status === "sent") {
      sentCount += 1;
      if (!opts.dryRun) {
        state.sentToday += 1;
      }
    } else if (entry.status === "queued") {
      sentCount += 1;
    } else {
      failedCount += 1;
    }

    saveQueue(queuePath, queue);
    updated = true;

    if (opts.live && !opts.dryRun && result.status === "sent") {
      saveState(state);
    }

    if (index < entries.length - 1 && opts.rateDelayMs && opts.rateDelayMs > 0) {
      console.log(`[delivery-worker] Waiting ${opts.rateDelayMs}ms before next send...`);
      await sleep(opts.rateDelayMs);
    }
  }

  const report = {
    queueId: queue.queueId,
    campaign: queue.campaign,
    targetEvent: queue.targetEvent,
    mode: opts.dryRun ? "dry-run" : "live",
    queuePath,
    batchSize,
    sent: sentCount,
    failed: failedCount,
    remainingToday: Math.max(0, env.MAX_SENDS_PER_DAY - state.sentToday),
    state,
    completedAt: formatTime(new Date()),
  };

  ensureDir(LOG_DIR);
  const reportFile = resolve(LOG_DIR, `delivery-worker-${Date.now()}.json`);
  writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf8");

  console.log(`\n[delivery-worker] Completed. Sent: ${sentCount}, Failed: ${failedCount}, Report: ${reportFile}`);
  return { queuePath, queue, sent: sentCount, failed: failedCount, updated };
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(name);
  const val = (name: string) => {
    const idx = args.indexOf(name);
    return idx === -1 ? undefined : args[idx + 1];
  };

  const queuePath = val("--queue");
  const live = flag("--live");
  const dryRun = !live;
  const limit = Number(val("--limit") ?? env.MAX_BATCH_SIZE);
  const rateDelayMs = Number(val("--rate-delay") ?? 120000);
  const retries = Number(val("--retries") ?? 2);

  try {
    await runDeliveryWorker({ queuePath, live, dryRun, limit, rateDelayMs, maxRetries: retries });
  } catch (error) {
    console.error("[delivery-worker] Unexpected failure:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (currentFile === process.argv[1]) {
  await main();
}
