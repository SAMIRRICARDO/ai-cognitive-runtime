import Anthropic from '@anthropic-ai/sdk';
import type { Lead, SearchFilters } from '../types/commercial.js';
import { AUTONOMY_CONFIG } from '../config/autonomyConfig.js';

export interface SessionMemory {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  currentState: CommercialState;
  lastIntent?: string;
  lastAction?: string;
  lastIndustry?: string;
  lastDepartment?: string;
  lastPosition?: string;
  lastLocation?: string;
  lastCompanySize?: string;
  lastSearchFilters?: SearchFilters;
  lastLeads?: Lead[];
  lastLead?: Lead;
  lastEnrichedLead?: Lead;
  lastOutreach?: {
    email?: string;
    linkedin?: string;
    whatsapp?: string;
    cold_call_script?: string;
  };
  lastOpportunityId?: string;
  conversationSummary?: string;
  messageCount: number;
  pendingGoal?: {
    intent: string;
    goal: string;
    steps: string[];
    filters: SearchFilters;
    confidence: number;
  };
}

export enum CommercialState {
  IDLE                = 'IDLE',
  SEARCHING_LEADS     = 'SEARCHING_LEADS',
  LEADS_FOUND         = 'LEADS_FOUND',
  LEADS_ENRICHED      = 'LEADS_ENRICHED',
  LEADS_SCORED        = 'LEADS_SCORED',
  OUTREACH_GENERATED  = 'OUTREACH_GENERATED',
  OPPORTUNITY_CREATED = 'OPPORTUNITY_CREATED'
}

export function createEmptySession(sessionId: string): SessionMemory {
  return {
    sessionId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentState: CommercialState.IDLE,
    messageCount: 0
  };
}

export function updateMemory(
  memory: SessionMemory,
  result: { output: Record<string, unknown>; steps_executed: string[]; next_action?: string },
  goalResult: { intent: string; goal: string; filters: SearchFilters }
): SessionMemory {
  const updated: SessionMemory = {
    ...memory,
    messageCount: memory.messageCount + 1,
    updatedAt: new Date().toISOString(),
    lastIntent: goalResult.intent,
    lastAction: result.steps_executed[result.steps_executed.length - 1]
  };

  if (goalResult.filters) {
    updated.lastSearchFilters = goalResult.filters;
    updated.lastIndustry = goalResult.filters.industry;
    updated.lastDepartment = goalResult.filters.department;
    updated.lastPosition = goalResult.filters.position;
    updated.lastLocation = goalResult.filters.location;
    updated.lastCompanySize = goalResult.filters.company_size;
  }

  if (result.output['leads']) {
    updated.lastLeads = result.output['leads'] as Lead[];
    if (updated.lastLeads.length > 0) {
      updated.lastLead = updated.lastLeads[0];
      updated.currentState = CommercialState.LEADS_FOUND;
    }
  }

  if (result.output['lead']) {
    const lead = result.output['lead'] as Lead;
    updated.lastLead = lead;
    if (lead.enriched) {
      updated.lastEnrichedLead = lead;
      updated.currentState = CommercialState.LEADS_ENRICHED;
    }
  }

  if (result.output['score'] !== undefined) {
    updated.currentState = CommercialState.LEADS_SCORED;
  }

  if (result.output['outreach_generated']) {
    updated.lastOutreach = result.output['outreach'] as SessionMemory['lastOutreach'];
    updated.currentState = CommercialState.OUTREACH_GENERATED;
  }

  if (result.output['opportunity']) {
    const opp = result.output['opportunity'] as Record<string, unknown>;
    updated.lastOpportunityId = opp['id'] as string;
    updated.currentState = CommercialState.OPPORTUNITY_CREATED;
  }

  return updated;
}

const SUMMARY_PROMPT = `
Gere um resumo comprimido da conversa comercial.
Inclua: objetivo do usuário, leads encontrados, estado atual, próximos passos.
Máximo 5 linhas. Retorne texto puro, sem markdown.
`.trim();

const client = new Anthropic();

export async function summarizeIfNeeded(memory: SessionMemory): Promise<SessionMemory> {
  if (memory.messageCount === 0 || memory.messageCount % AUTONOMY_CONFIG.summary_interval !== 0) {
    return memory;
  }

  const contextText = [
    memory.lastIntent && `Último intent: ${memory.lastIntent}`,
    memory.lastLeads && `Leads: ${memory.lastLeads.map(l => l.name).join(', ')}`,
    `Estado: ${memory.currentState}`,
    memory.lastOpportunityId && `Oportunidade: ${memory.lastOpportunityId}`,
  ].filter(Boolean).join('\n');

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: SUMMARY_PROMPT,
      messages: [{ role: 'user', content: contextText }]
    });

    const summary = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    return { ...memory, conversationSummary: summary, updatedAt: new Date().toISOString() };
  } catch {
    return memory;
  }
}
