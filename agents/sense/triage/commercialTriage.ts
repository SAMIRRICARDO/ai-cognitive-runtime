// NÍVEL 1 — Triagem barata via Haiku.
// Só roda para eventos que já passaram pelo filtro Nível 0.

import Anthropic from '@anthropic-ai/sdk';
import { SENSE_CONFIG } from '../../../config/senseConfig.js';
import { COMMERCIAL_TRIAGE_PROMPT } from '../../../prompts/sense/commercialTriagePrompt.js';
import type { RawEvent } from '../filters/commercialFilter.js';

const client = new Anthropic();

export interface TriageResult {
  relevant: boolean;
  quick_signal: 'high' | 'low' | 'none';
}

export async function commercialTriage(event: RawEvent): Promise<TriageResult> {
  const { triageModel, triageMaxTokens } = SENSE_CONFIG.commercial;

  const response = await client.messages.create({
    model: triageModel,
    max_tokens: triageMaxTokens,
    system: COMMERCIAL_TRIAGE_PROMPT,
    messages: [{ role: 'user', content: event.message_content }],
  });

  const raw = response.content[0].type === 'text'
    ? response.content[0].text.trim()
    : '{"relevant":false,"quick_signal":"none"}';

  console.log(`[Sense/Triage] raw="${raw}"`);

  // Strip markdown code fences if model wrapped JSON anyway
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  try {
    return JSON.parse(cleaned) as TriageResult;
  } catch {
    console.warn(`[Sense/Triage] parse falhou para: "${cleaned}"`);
    return { relevant: false, quick_signal: 'none' };
  }
}
