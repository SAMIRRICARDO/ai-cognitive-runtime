import crypto from "crypto";
import { RedisMemory } from "../../memory/short-term/redis.js";
import { logger } from "../../config/logger.js";

export interface CachedResponse {
  output: string;
  model: string;
  cachedAt: number;
}

export class ResponseCache {
  private redis: RedisMemory;

  // Cache TTL by tier — deterministic calls cache longer
  static TTL = {
    low: 86_400,    // 24h — simple tasks are stable
    medium: 3_600,  // 1h
    high: 900,      // 15min — complex tasks may need freshness
    default: 3_600,
  } as const;

  constructor(namespace = "") {
    this.redis = new RedisMemory(namespace);
  }

  key(model: string, systemPrompt: string, userMessage: string): string {
    return (
      "agent:resp:" +
      crypto
        .createHash("sha256")
        .update(`${model}\n${systemPrompt}\n${userMessage}`)
        .digest("hex")
        .slice(0, 24)
    );
  }

  async get(key: string): Promise<CachedResponse | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as CachedResponse;
    } catch {
      return null;
    }
  }

  async set(key: string, response: CachedResponse, ttl: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(response), ttl);
      logger.debug("[cache] stored response", { key, ttl });
    } catch (err) {
      logger.warn("[cache] failed to store response", { err });
    }
  }
}

export const responseCache = new ResponseCache();
