import Anthropic from '@anthropic-ai/sdk';
import { GOAL_INFERENCE_PROMPT } from '../../prompts/commercial/goalInferencePrompt.js';
import type { SessionMemory } from '../../memory/sessionMemory.js';
import type { SearchFilters } from '../../types/commercial.js';

const client = new Anthropic();

export interface GoalInferenceResult {
  intent: string;
  goal: string;
  steps: string[];
  filters: SearchFilters;
  confidence: number;
}

export async function inferGoal(
  userRequest: string,
  memory: SessionMemory
): Promise<GoalInferenceResult> {
  const contextBlock = memory.conversationSummary
    ? `\nContexto anterior: ${memory.conversationSummary}`
    : '';
  const stateBlock = `\nEstado atual: ${memory.currentState}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    system: GOAL_INFERENCE_PROMPT,
    messages: [{
      role: 'user',
      content: `Pedido: "${userRequest}"${contextBlock}${stateBlock}`
    }]
  });

  const rawText = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';
  const raw = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    return JSON.parse(raw) as GoalInferenceResult;
  } catch {
    return {
      intent: 'buscar_lead',
      goal: 'create_sales_opportunity',
      steps: ['search_lead'],
      filters: {},
      confidence: 0.5
    };
  }
}
