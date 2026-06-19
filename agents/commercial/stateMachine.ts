import { CommercialState } from '../../memory/sessionMemory.js';
import type { SessionMemory } from '../../memory/sessionMemory.js';

export { CommercialState };

const VALID_TRANSITIONS: Record<CommercialState, CommercialState[]> = {
  [CommercialState.IDLE]: [
    CommercialState.SEARCHING_LEADS
  ],
  [CommercialState.SEARCHING_LEADS]: [
    CommercialState.LEADS_FOUND,
    CommercialState.IDLE
  ],
  [CommercialState.LEADS_FOUND]: [
    CommercialState.LEADS_ENRICHED,
    CommercialState.OUTREACH_GENERATED,
    CommercialState.SEARCHING_LEADS
  ],
  [CommercialState.LEADS_ENRICHED]: [
    CommercialState.LEADS_SCORED,
    CommercialState.OUTREACH_GENERATED
  ],
  [CommercialState.LEADS_SCORED]: [
    CommercialState.OUTREACH_GENERATED,
    CommercialState.LEADS_ENRICHED
  ],
  [CommercialState.OUTREACH_GENERATED]: [
    CommercialState.OPPORTUNITY_CREATED,
    CommercialState.SEARCHING_LEADS
  ],
  [CommercialState.OPPORTUNITY_CREATED]: [
    CommercialState.IDLE,
    CommercialState.SEARCHING_LEADS
  ]
};

export function canTransition(
  from: CommercialState,
  to: CommercialState
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transition(
  memory: SessionMemory,
  to: CommercialState
): SessionMemory {
  if (!canTransition(memory.currentState, to)) {
    console.warn(`[StateMachine] Transição inválida: ${memory.currentState} → ${to}`);
    return memory;
  }
  return {
    ...memory,
    currentState: to,
    updatedAt: new Date().toISOString()
  };
}
