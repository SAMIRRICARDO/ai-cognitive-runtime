import { createClient } from "redis";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import type { AgentMemory } from "../../agents/_base/types.js";

export class RedisMemory implements AgentMemory {
  private client: ReturnType<typeof createClient>;
  private connected = false;
  private unavailable = false;

  constructor() {
    this.client = createClient({
      url: env.REDIS_URL,
      socket: { reconnectStrategy: false },
    });
    this.client.on("error", () => {}); // suppress error events — handled in connect()
  }

  private async connect(): Promise<void> {
    if (this.connected || this.unavailable) return;
    try {
      await this.client.connect();
      this.connected = true;
    } catch {
      this.unavailable = true;
      logger.warn("[redis] unavailable — operations will be no-ops");
      // Stop reconnection loop to prevent repeated error events
      this.client.disconnect().catch(() => {});
    }
  }

  async get(key: string): Promise<string | null> {
    await this.connect();
    if (!this.connected) return null;
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.connect();
    if (!this.connected) return;
    try {
      if (ttlSeconds) {
        await this.client.setEx(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
    } catch { /* no-op */ }
  }

  async delete(key: string): Promise<void> {
    await this.connect();
    if (!this.connected) return;
    try {
      await this.client.del(key);
    } catch { /* no-op */ }
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.disconnect();
      this.connected = false;
    }
  }
}
