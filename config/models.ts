import { env } from "./env.js";

export const Models = {
  default: env.DEFAULT_MODEL,
  fast: env.FAST_MODEL,
  powerful: env.POWERFUL_MODEL,
} as const;

export const ModelConfig = {
  maxTokens: {
    default: 8192,
    extended: 16384,
  },
  temperature: {
    deterministic: 0,
    balanced: 0.3,
    creative: 0.7,
  },
} as const;
