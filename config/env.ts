import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  // ── Memory ────────────────────────────────────────────────────────────────
  ENABLE_MEMORY:    z.string().optional(),
  MEMORY_PROVIDER:  z.string().optional(),

  // ── API Keys ──────────────────────────────────────────────────────────────
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY:    z.string().optional(),
  TAVILY_API_KEY:    z.string().optional(),
  RESEND_API_KEY:    z.string().optional().default(""),
  RESEND_FROM_EMAIL: z.string().email().optional(),
  RESEND_FROM_NAME:  z.string().optional(),

  // ── Models ────────────────────────────────────────────────────────────────
  DEFAULT_MODEL:  z.string().default("claude-haiku-4-5-20251001"),
  FAST_MODEL:     z.string().default("claude-haiku-4-5-20251001"),
  POWERFUL_MODEL: z.string().default("claude-sonnet-4-6"),

  // ── Infrastructure ────────────────────────────────────────────────────────
  REDIS_URL:    z.string().default("redis://localhost:6379"),
  DATABASE_URL: z.string().optional(),
  VAULT_PATH:   z.string().default("~/obsidian-vault"),

  // ── Observability ─────────────────────────────────────────────────────────
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // ── Cost / Dev mode ───────────────────────────────────────────────────────
  DEV_MODE:           z.string().optional().default("false"),
  CHEAP_MODE:         z.string().optional().default("false"),
  MAX_TOOL_ITERATIONS: z.coerce.number().int().positive().optional(),
  MAX_OUTPUT_TOKENS:   z.coerce.number().int().positive().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

// Derived helpers — read once at startup
export const isCheapMode = env.CHEAP_MODE === "true" || env.DEV_MODE === "true";
