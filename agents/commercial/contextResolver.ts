import type { SessionMemory } from '../../memory/sessionMemory.js';

export function resolveReferences(
  input: string,
  memory: SessionMemory
): Record<string, unknown> {
  const text = input.toLowerCase();
  const resolved: Record<string, unknown> = {};

  if (text.includes('esse lead') || text.includes('ele') || text.includes('ela')) {
    resolved['target_lead'] = memory.lastLead;
  }
  if (text.includes('esses leads') || text.includes('eles') || text.includes('elas')) {
    resolved['target_leads'] = memory.lastLeads;
  }
  if (text.includes('o primeiro') || text.includes('primeiro lead')) {
    resolved['target_lead'] = memory.lastLeads?.[0];
  }
  if (text.includes('o segundo') || text.includes('segundo lead')) {
    resolved['target_lead'] = memory.lastLeads?.[1];
  }
  if (text.includes('o terceiro')) {
    resolved['target_lead'] = memory.lastLeads?.[2];
  }

  if (text.includes('essa empresa') || text.includes('a empresa')) {
    resolved['target_company'] = memory.lastLead?.company;
  }

  if (text.includes('continue') || text.includes('continua') || text.includes('próximo')) {
    resolved['continue_from'] = memory.lastAction;
    resolved['current_state'] = memory.currentState;
  }

  if (text.includes('mesmo segmento') || text.includes('mesma área')) {
    resolved['reuse_filters'] = memory.lastSearchFilters;
  }

  return resolved;
}
