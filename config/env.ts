import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  DEFAULT_MODEL: z.string().default("claude-sonnet-4-6"),
  FAST_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  POWERFUL_MODEL: z.string().default("claude-opus-4-7"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  DATABASE_URL: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  TAVILY_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  VAULT_PATH: z.string().default("~/obsidian-vault"),
  RESEND_API_KEY: z.string().optional().default(""),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
