import { env, isCheapMode } from "./env.js";

export const Models = {
  default: env.DEFAULT_MODEL,
  fast: env.FAST_MODEL,
  powerful: env.POWERFUL_MODEL,
} as const;

export const ModelConfig = {
  maxTokens: {
    default: 8192,
    extended: 16384,
    cheap: 512,
  },
  temperature: {
    deterministic: 0,
    balanced: 0.3,
    creative: 0.7,
  },
} as const;

/**
 * Resolves effective max_tokens respecting cost controls.
 * `preferred` is the agent's desired limit; env vars/cheap mode can cap it lower.
 */
export function getMaxTokens(preferred?: number): number {
  const base = preferred ?? ModelConfig.maxTokens.default;
  if (env.MAX_OUTPUT_TOKENS) return Math.min(base, env.MAX_OUTPUT_TOKENS);
  if (isCheapMode) return Math.min(base, ModelConfig.maxTokens.cheap);
  return base;
}

/**
 * Resolves effective maxIterations respecting cost controls.
 * Agent-specific overrides are still capped by MAX_TOOL_ITERATIONS if set.
 */
export function getMaxIterations(preferred?: number): number {
  // Explicit env override is always the hard cap — takes priority over cheap mode defaults
  if (env.MAX_TOOL_ITERATIONS) return env.MAX_TOOL_ITERATIONS;
  const base = preferred ?? (isCheapMode ? 3 : 10);
  return base;
}
