// Strips markdown code fences from LLM responses that should return bare JSON.
// Haiku sometimes wraps JSON in ```json...``` despite instructions.
export function stripJsonFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}
