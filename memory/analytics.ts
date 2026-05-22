import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ANALYTICS_DIR = resolve(ROOT, "memory", "analytics");
const SUMMARY_FILE = resolve(ANALYTICS_DIR, "summary.json");

export type AnalyticsProvider = "openai" | "claude" | "runtime" | "outbound" | "cache";

export interface AnalyticsEvent {
  timestamp?: string;
  provider: AnalyticsProvider;
  source: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  requests?: number;
  leadsGenerated?: number;
  cacheHits?: number;
  estimatedSavingsUsd?: number;
  outboundExecuted?: number;
  metadata?: Record<string, unknown>;
}

interface AnalyticsSummary {
  updatedAt: string;
  openaiTokens: number;
  claudeTokens: number;
  estimatedCostUsd: number;
  requests: number;
  leadsGenerated: number;
  cacheHits: number;
  estimatedSavingsUsd: number;
  outboundExecuted: number;
  bySource: Record<string, {
    requests: number;
    tokens: number;
    estimatedCostUsd: number;
    leadsGenerated: number;
    cacheHits: number;
    outboundExecuted: number;
  }>;
}

function ensureDir() {
  mkdirSync(ANALYTICS_DIR, { recursive: true });
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function eventPath(date = new Date()) {
  return resolve(ANALYTICS_DIR, `${todayKey(date)}.jsonl`);
}

function emptySummary(): AnalyticsSummary {
  return {
    updatedAt: new Date().toISOString(),
    openaiTokens: 0,
    claudeTokens: 0,
    estimatedCostUsd: 0,
    requests: 0,
    leadsGenerated: 0,
    cacheHits: 0,
    estimatedSavingsUsd: 0,
    outboundExecuted: 0,
    bySource: {},
  };
}

function readSummary(): AnalyticsSummary {
  ensureDir();
  if (!existsSync(SUMMARY_FILE)) return emptySummary();
  return JSON.parse(readFileSync(SUMMARY_FILE, "utf8")) as AnalyticsSummary;
}

function writeSummary(summary: AnalyticsSummary) {
  ensureDir();
  writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");
}

export function estimateOpenAICost(model: string | undefined, inputTokens = 0, outputTokens = 0) {
  if (model === "gpt-4o-mini") {
    return (inputTokens / 1_000_000) * 0.15 + (outputTokens / 1_000_000) * 0.60;
  }
  return (inputTokens / 1_000_000) * 0.50 + (outputTokens / 1_000_000) * 1.50;
}

export function recordAnalytics(event: AnalyticsEvent) {
  ensureDir();
  const timestamp = event.timestamp ?? new Date().toISOString();
  const inputTokens = event.inputTokens ?? 0;
  const outputTokens = event.outputTokens ?? 0;
  const totalTokens = event.totalTokens ?? inputTokens + outputTokens;
  const enriched: AnalyticsEvent = {
    ...event,
    timestamp,
    inputTokens,
    outputTokens,
    totalTokens,
    requests: event.requests ?? 0,
    leadsGenerated: event.leadsGenerated ?? 0,
    cacheHits: event.cacheHits ?? 0,
    estimatedSavingsUsd: event.estimatedSavingsUsd ?? 0,
    outboundExecuted: event.outboundExecuted ?? 0,
  };

  appendFileSync(eventPath(new Date(timestamp)), `${JSON.stringify(enriched)}\n`, "utf8");

  const summary = readSummary();
  summary.updatedAt = timestamp;
  if (event.provider === "openai") summary.openaiTokens += totalTokens;
  if (event.provider === "claude") summary.claudeTokens += totalTokens;
  summary.estimatedCostUsd += event.estimatedCostUsd ?? 0;
  summary.requests += enriched.requests ?? 0;
  summary.leadsGenerated += enriched.leadsGenerated ?? 0;
  summary.cacheHits += enriched.cacheHits ?? 0;
  summary.estimatedSavingsUsd += enriched.estimatedSavingsUsd ?? 0;
  summary.outboundExecuted += enriched.outboundExecuted ?? 0;

  const bySource = summary.bySource[event.source] ?? {
    requests: 0,
    tokens: 0,
    estimatedCostUsd: 0,
    leadsGenerated: 0,
    cacheHits: 0,
    outboundExecuted: 0,
  };
  bySource.requests += enriched.requests ?? 0;
  bySource.tokens += totalTokens;
  bySource.estimatedCostUsd += event.estimatedCostUsd ?? 0;
  bySource.leadsGenerated += enriched.leadsGenerated ?? 0;
  bySource.cacheHits += enriched.cacheHits ?? 0;
  bySource.outboundExecuted += enriched.outboundExecuted ?? 0;
  summary.bySource[event.source] = bySource;

  writeSummary(summary);
  return enriched;
}

ensureDir();
