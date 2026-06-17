import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { TenantEnv } from "../../tenant/types.js";

export type MessageParam = Anthropic.MessageParam;
export type ContentBlock = Anthropic.ContentBlock;
export type Tool = Anthropic.Tool;
export type ToolResultBlockParam = Anthropic.ToolResultBlockParam;

export interface AgentConfig {
  name: string;
  description: string;
  /** Model ID, or "auto" to enable automatic routing based on task complexity. */
  model?: string | "auto";
  maxTokens?: number;
  temperature?: number;
  systemPrompt: string;
  tools?: Tool[];
  maxIterations?: number;
  /** Max context tokens before triggering compression. Default: 80_000. */
  contextTokenLimit?: number;
  /** Cache single-turn responses in Redis. Default: false. */
  enableResponseCache?: boolean;
  /** Response cache TTL in seconds. Default: depends on routing tier. */
  cacheTtl?: number;
  /** Inject relevant past memories into system prompt before each run. Default: false. */
  memoryEnabled?: boolean;
  /** Extract and store memories after each run. Default: false. */
  memorySaveEnabled?: boolean;

  // ── Multi-tenant (SaaS / BYOK) ──────────────────────────────────────────
  /** Tenant identifier. Omit for single-tenant / dev mode. */
  tenantId?: string;
  /** BYOK API keys for this tenant. Overrides global env when provided. */
  tenantEnv?: TenantEnv;
}

export interface AgentResult<T = unknown> {
  output: T;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
  cost?: {
    totalCostUsd: number;
    savings: number;
    breakdown: Record<string, number>;
  };
  routing?: { tier: string; model: string; score: number; reason: string };
  fromCache?: boolean;
  contextCompressed?: boolean;
  memoriesLoaded?: number;
  memoriesSaved?: number;
  iterations: number;
  durationMs: number;
}

export interface ToolHandler {
  name: string;
  schema: Tool;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface AgentMemory {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export type AgentRunOptions = {
  sessionId?: string;
  onStep?: (step: AgentStep) => void;
};

export type AgentStep =
  | { type: "thinking"; content: string }
  | { type: "tool_call"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; result: unknown }
  | { type: "output"; content: string };

export interface SchemaShape {
  [key: string]: z.ZodTypeAny;
}
