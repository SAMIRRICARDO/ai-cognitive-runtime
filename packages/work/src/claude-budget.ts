const CHEAP_MODE = (process.env.CHEAP_MODE ?? "true") === "true";
const PREFERRED_MODEL = process.env.DEFAULT_MODEL ?? "claude-haiku-4-5-20251001";
const CHEAP_MAX_OUTPUT_TOKENS = 600;

export function claudeModel(preferred: string): string {
  return CHEAP_MODE ? PREFERRED_MODEL : preferred;
}

export function claudeMaxTokens(preferred: number): number {
  if (!CHEAP_MODE) return preferred;
  const envLimit = Number(process.env.MAX_OUTPUT_TOKENS ?? CHEAP_MAX_OUTPUT_TOKENS);
  return Math.min(preferred, envLimit, CHEAP_MAX_OUTPUT_TOKENS);
}
