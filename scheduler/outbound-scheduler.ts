#!/usr/bin/env tsx
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { env } from "../config/env.js";
import { runDeliveryWorker } from "../workers/delivery-worker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function parseTimeString(value: string) {
  const parts = value.split(":").map((segment) => Number(segment.trim()));
  if (parts.length !== 2 || parts.some(Number.isNaN)) return null;
  const [hours, minutes] = parts;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function hasFlag(name: string, args: string[]) {
  return args.includes(name);
}

function getFlagValue(name: string, args: string[]) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function isBusinessHours(now: Date) {
  const weekday = now.getDay();
  if (env.WEEKEND_BLOCK && (weekday === 0 || weekday === 6)) {
    return false;
  }

  const startMinutes = 9 * 60;
  const endMinutes = parseTimeString(env.NO_SEND_AFTER) ?? 16 * 60;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

async function main() {
  const args = process.argv.slice(2);
  const live = hasFlag("--live", args);
  const dryRun = !live;
  const queuePath = getFlagValue("--queue", args);
  const limit = Number(getFlagValue("--limit", args) ?? env.MAX_BATCH_SIZE);
  const rateDelayMs = Number(getFlagValue("--rate-delay", args) ?? env.OUTBOUND_RATE_DELAY_MS);
  const retries = Number(getFlagValue("--retries", args) ?? 2);

  const now = new Date();
  const sendAllowed = isBusinessHours(now);

  console.log("[outbound-scheduler] Starting outbound scheduler");
  console.log(`  Live mode: ${live}`);
  console.log(`  Queue path: ${queuePath ?? "latest"}`);
  console.log(`  Max batch size: ${limit}`);
  console.log(`  Rate delay: ${rateDelayMs}ms`);
  console.log(`  Weekend block: ${env.WEEKEND_BLOCK}`);
  console.log(`  No-send after: ${env.NO_SEND_AFTER}`);
  console.log(`  Current time: ${now.toISOString()}`);

  if (!sendAllowed) {
    console.log("[outbound-scheduler] Current time is outside approved outbound window. No sends executed.");
    process.exit(0);
  }

  await runDeliveryWorker({ queuePath, live, dryRun, limit, rateDelayMs, maxRetries: retries });
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
