import Anthropic from '@anthropic-ai/sdk';
import {
  BEHAVIORAL_ANALYSIS_PROMPT,
  STRATEGIC_ANALYSIS_PROMPT,
  INTELLIGENCE_SYNTHESIS_PROMPT
} from '../../prompts/commercial/leadIntelligencePrompt.js';
import type { Lead, AgentOutput } from '../../types/commercial.js';
import type { SessionMemory } from '../../memory/sessionMemory.js';

const client = new Anthropic();

export interface LeadIntelligence {
  lead: Lead;
  behavioral: Record<string, unknown>;
  strategic: Record<string, unknown>;
  composite_score: number;
  tier: 'A' | 'B' | 'C' | 'D';
  win_probability: number;
  estimated_deal_size: string;
  opening_hook: string;
  key_pain_to_address: string;
  social_proof_to_use: string | null;
  red_flags: string[];
  green_flags: string[];
  recommended_action: string;
  best_approach: string;
}

function stripMarkdown(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function safeJsonParse(response: Anthropic.Message): Record<string, unknown> {
  const raw = response.content[0].type === 'text' ? stripMarkdown(response.content[0].text) : '{}';
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

export async function runLeadIntelligence360(
  input: { lead: Lead },
  memory: SessionMemory
): Promise<AgentOutput> {
  const lead = input.lead;
  if (!lead) {
    return { success: false, data: {}, error: 'Lead não fornecido para Lead Intelligence 360°' };
  }

  const leadContext = JSON.stringify(lead);

  // CHAMADA 1 — Análise comportamental (Haiku, 100 tokens, custo zero)
  const [behavioralRes, strategicRes] = await Promise.all([
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: BEHAVIORAL_ANALYSIS_PROMPT,
      messages: [{ role: 'user', content: leadContext }]
    }),
    // CHAMADA 2 — Análise estratégica (Haiku, 200 tokens) — em paralelo com a 1
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: STRATEGIC_ANALYSIS_PROMPT,
      messages: [{ role: 'user', content: leadContext }]
    })
  ]);

  const behavioralRaw = behavioralRes.content[0].type === 'text' ? behavioralRes.content[0].text : '{}';
  const strategicRaw = strategicRes.content[0].type === 'text' ? strategicRes.content[0].text : '{}';
  console.log('[Intelligence360] Behavioral raw:', behavioralRaw.slice(0, 150));
  console.log('[Intelligence360] Strategic raw:', strategicRaw.slice(0, 150));
  const behavioral = safeJsonParse(behavioralRes);
  const strategic = safeJsonParse(strategicRes);

  // CHAMADA 3 — Síntese final (Sonnet, 600 tokens — qualidade crítica)
  const synthesisContext = JSON.stringify({ lead, behavioral, strategic });

  const synthesisRes = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    system: INTELLIGENCE_SYNTHESIS_PROMPT,
    messages: [{ role: 'user', content: synthesisContext }]
  });

  const rawSynthesis = synthesisRes.content[0].type === 'text' ? synthesisRes.content[0].text : '{}';
  console.log('[Intelligence360] Synthesis raw:', rawSynthesis.slice(0, 200));
  const synthesis = safeJsonParse(synthesisRes);

  const compositeScore = typeof synthesis['composite_score'] === 'number'
    ? synthesis['composite_score'] as number
    : 50;

  const tier = (synthesis['tier'] as string) ?? 'C';
  const shouldDiscard = tier === 'D';

  const intelligence: LeadIntelligence = {
    lead,
    behavioral,
    strategic,
    composite_score: compositeScore,
    tier: tier as 'A' | 'B' | 'C' | 'D',
    win_probability: (synthesis['win_probability'] as number) ?? 0,
    estimated_deal_size: (synthesis['estimated_deal_size'] as string) ?? '',
    opening_hook: (synthesis['opening_hook'] as string) ?? '',
    key_pain_to_address: (synthesis['key_pain_to_address'] as string) ?? '',
    social_proof_to_use: (synthesis['social_proof_to_use'] as string) ?? null,
    red_flags: (synthesis['red_flags'] as string[]) ?? [],
    green_flags: (synthesis['green_flags'] as string[]) ?? [],
    recommended_action: (synthesis['recommended_action'] as string) ?? '',
    best_approach: (synthesis['best_approach'] as string) ?? 'linkedin'
  };

  console.log(`[Intelligence360] ${lead.name} — Score: ${compositeScore} | Tier: ${tier} | Win: ${intelligence.win_probability}%`);

  return {
    success: true,
    data: {
      intelligence,
      lead: { ...lead, score: compositeScore, fit: compositeScore >= 70 ? 'high' : compositeScore >= 50 ? 'medium' : 'low' },
      score: compositeScore,
      tier
    },
    next_action: shouldDiscard ? 'discard_lead' : 'generate_outreach'
  };
}
