import Anthropic from '@anthropic-ai/sdk';
import { OUTREACH_PROMPT } from '../../prompts/commercial/outreachPrompt.js';
import type { Lead, AgentOutput } from '../../types/commercial.js';
import type { SessionMemory } from '../../memory/sessionMemory.js';

const client = new Anthropic();

export async function runOutreach(
  input: { lead: Lead },
  memory: SessionMemory
): Promise<AgentOutput> {
  if (!input.lead) {
    return { success: false, data: {}, error: 'Lead não fornecido para outreach' };
  }

  if (input.lead.score !== undefined && input.lead.score < 60) {
    return {
      success: true,
      data: { skipped: true, reason: 'Score abaixo do threshold (60)' },
      next_action: 'skip_low_score'
    };
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    system: OUTREACH_PROMPT,
    messages: [{
      role: 'user',
      content: `Lead para abordar: ${JSON.stringify(input.lead)}`
    }]
  });

  const rawText = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';
  const raw = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      success: true,
      data: { lead: input.lead, outreach: parsed, outreach_generated: true },
      next_action: 'create_crm_opportunity'
    };
  } catch {
    return { success: false, data: {}, error: 'Erro na geração de outreach' };
  }
}
