import { RedisMemory } from "../memory/short-term/redis.js";
import { logger } from "./logger.js";

// USD per 1M tokens
export const MODEL_PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-haiku-4-5-20251001": { input: 0.80,  output: 4.00,  cacheWrite: 1.00,  cacheRead: 0.08  },
  "claude-sonnet-4-6":         { input: 3.00,  output: 15.00, cacheWrite: 3.75,  cacheRead: 0.30  },
  "claude-opus-4-7":           { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50  },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheWriteCost: number;
  cacheReadCost: number;
  totalCost: number;
  /** Estimated cost without any caching */
  wouldHaveCost: number;
  savings: number;
}

export function calculateCost(model: string, usage: TokenUsage): CostBreakdown {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["claude-sonnet-4-6"];
  const M = 1_000_000;

  const inputCost       = (usage.inputTokens / M) * pricing.input;
  const outputCost      = (usage.outputTokens / M) * pricing.output;
  const cacheWriteCost  = (usage.cacheCreationTokens / M) * pricing.cacheWrite;
  const cacheReadCost   = (usage.cacheReadTokens / M) * pricing.cacheRead;
  const totalCost       = inputCost + outputCost + cacheWriteCost + cacheReadCost;

  const wouldHaveCost =
    ((usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens) / M) * pricing.input +
    outputCost;

  return {
    inputCost,
    outputCost,
    cacheWriteCost,
    cacheReadCost,
    totalCost,
    wouldHaveCost,
    savings: wouldHaveCost - totalCost,
  };
}

export function formatCost(usd: number): string {
  if (usd < 0.0001) return `$${(usd * 1000).toFixed(4)}m`;
  return `$${usd.toFixed(6)}`;
}

// Redis-backed cost aggregator
const redis = new RedisMemory();
const COST_KEY_PREFIX = "agent:costs:";
const COST_TTL = 86_400 * 30; // 30 days

export interface AgentCostRecord {
  agent: string;
  model: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalSavingsUsd: number;
  runs: number;
  lastRunAt: string;
}

export async function recordCost(
  agentName: string,
  model: string,
  usage: TokenUsage,
  cost: CostBreakdown
): Promise<void> {
  const key = `${COST_KEY_PREFIX}${agentName}`;
  try {
    const existing = await redis.get(key);
    const record: AgentCostRecord = existing
      ? JSON.parse(existing)
      : {
          agent: agentName,
          model,
          totalCostUsd: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheReadTokens: 0,
          totalCacheCreationTokens: 0,
          totalSavingsUsd: 0,
          runs: 0,
          lastRunAt: "",
        };

    record.totalCostUsd           += cost.totalCost;
    record.totalInputTokens       += usage.inputTokens;
    record.totalOutputTokens      += usage.outputTokens;
    record.totalCacheReadTokens   += usage.cacheReadTokens;
    record.totalCacheCreationTokens += usage.cacheCreationTokens;
    record.totalSavingsUsd        += cost.savings;
    record.runs                   += 1;
    record.lastRunAt               = new Date().toISOString();
    record.model                   = model;

    await redis.set(key, JSON.stringify(record), COST_TTL);
  } catch (err) {
    logger.warn("[costs] failed to record", { err });
  }
}

export async function getCostReport(): Promise<AgentCostRecord[]> {
  // Note: requires redis SCAN — returns known agents by querying known keys
  // In practice, callers can pass explicit agent names
  logger.warn("[costs] getCostReport requires explicit agent names; use getCostForAgent()");
  return [];
}

export async function getCostForAgent(agentName: string): Promise<AgentCostRecord | null> {
  const raw = await redis.get(`${COST_KEY_PREFIX}${agentName}`);
  return raw ? (JSON.parse(raw) as AgentCostRecord) : null;
}
