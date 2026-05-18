import { createClient } from "redis";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import type { AgentMemory } from "../../agents/_base/types.js";

export class RedisMemory implements AgentMemory {
  private client: ReturnType<typeof createClient>;
  private connected = false;

  constructor() {
    this.client = createClient({ url: env.REDIS_URL });
    this.client.on("error", (err) => logger.warn("Redis error", { err }));
  }

  private async connect(): Promise<void> {
    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
    }
  }

  async get(key: string): Promise<string | null> {
    await this.connect();
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.connect();
    if (ttlSeconds) {
      await this.client.setEx(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async delete(key: string): Promise<void> {
    await this.connect();
    await this.client.del(key);
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.disconnect();
      this.connected = false;
    }
  }
}
