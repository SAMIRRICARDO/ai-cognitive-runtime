import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  // ── Memory ────────────────────────────────────────────────────────────────
  ENABLE_MEMORY:    z.string().optional(),
  MEMORY_PROVIDER:  z.string().optional(),

  // ── SaaS / Multi-tenant ───────────────────────────────────────────────────
  // Required in production; omit in single-tenant / dev mode.
  VRAXIA_MASTER_KEY: z.string().min(32).optional(),
  VRAXIA_ADMIN_KEY:  z.string().optional(),
  API_PORT:          z.coerce.number().int().positive().default(3000),

  // ── API Keys ──────────────────────────────────────────────────────────────
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY:    z.string().optional(),
  TAVILY_API_KEY:    z.string().optional(),
  RESEND_API_KEY:       z.string().optional().default(""),
  RESEND_FROM_EMAIL:    z.string().email().optional(),
  RESEND_FROM_NAME:     z.string().optional(),
  MEDIA_KIT_PDF:        z.string().optional(),
  OUTBOUND_BCC_EMAIL:   z.string().email().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  WEBHOOK_PORT:          z.coerce.number().int().positive().default(4000),

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

  // ── Outbound delivery limits and scheduling ─────────────────────────────────
  MAX_SENDS_PER_DAY: z.coerce.number().int().positive().default(5),
  MAX_BATCH_SIZE: z.coerce.number().int().positive().default(5),
  NO_SEND_AFTER: z.string().default("16:00"),
  WEEKEND_BLOCK: z.string().default("true"),
  OUTBOUND_RATE_DELAY_MS: z.coerce.number().int().nonnegative().default(120000),

  // ── Cost / Dev mode ───────────────────────────────────────────────────────
  DEV_MODE:           z.string().optional().default("false"),
  CHEAP_MODE:         z.string().optional().default("false"),
  DEMO_MODE:          z.string().optional().default("false"),
  MAX_TOOL_ITERATIONS: z.coerce.number().int().positive().optional(),
  MAX_OUTPUT_TOKENS:   z.coerce.number().int().positive().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  MAX_SENDS_PER_DAY: parsed.data.MAX_SENDS_PER_DAY,
  MAX_BATCH_SIZE: parsed.data.MAX_BATCH_SIZE,
  NO_SEND_AFTER: parsed.data.NO_SEND_AFTER,
  WEEKEND_BLOCK: parsed.data.WEEKEND_BLOCK === "true",
  OUTBOUND_RATE_DELAY_MS: parsed.data.OUTBOUND_RATE_DELAY_MS,
};

// Derived helpers — read once at startup
// DEV_MODE apenas bypassa auth, não implica cheap mode
export const isCheapMode = env.CHEAP_MODE === "true";
export const isDemoMode  = env.DEMO_MODE  === "true";
