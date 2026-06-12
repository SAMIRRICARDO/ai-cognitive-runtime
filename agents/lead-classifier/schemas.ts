import { z } from 'zod';

export const ClassificationResultSchema = z.object({
  variant:        z.enum(['A', 'B', 'C', 'D', 'E']),
  intent:         z.enum(['high', 'medium', 'low', 'none']),
  decision_power: z.enum(['high', 'mid', 'low']),
  score:          z.number().int().min(1).max(10),
  handoff:        z.boolean(),
  reason:         z.string().max(200),
  suggested_next_action: z.string(),
});

export type ClassificationResultParsed = z.infer<typeof ClassificationResultSchema>;

/** Safe JSON parse + schema validation. Returns null on any failure. */
export function parseClassification(raw: string): ClassificationResultParsed | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    const result = ClassificationResultSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Fallback when LLM returns unparseable output */
export const FALLBACK_CLASSIFICATION: ClassificationResultParsed = {
  variant:        'B',
  intent:         'medium',
  decision_power: 'mid',
  score:          5,
  handoff:        false,
  reason:         'Resposta ambígua — fallback aplicado',
  suggested_next_action: 'Revisar manualmente e reenviar se necessário',
};
