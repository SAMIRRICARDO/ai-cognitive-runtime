import { AUTONOMY_CONFIG } from '../../config/autonomyConfig.js';
import type { GoalInferenceResult } from '../sense/goalInference.js';
import type { ExecutionPlan, PipelineStep } from '../../types/commercial.js';
import type { SessionMemory } from '../../memory/sessionMemory.js';

export async function createExecutionPlan(
  goal: GoalInferenceResult,
  resolved: Record<string, unknown>,
  memory: SessionMemory
): Promise<ExecutionPlan> {
  const allowedSteps = filterStepsByAutonomy(goal.steps, AUTONOMY_CONFIG.level);

  const steps: PipelineStep[] = allowedSteps.map(action => ({
    agent: getAgentForAction(action),
    action,
    status: 'pending' as const,
    input: buildStepInput(action, goal, resolved, memory)
  }));

  return {
    goal: goal.goal,
    steps,
    autonomy_level: AUTONOMY_CONFIG.level,
    estimated_cost_usd: estimateCost(allowedSteps)
  };
}

export function filterStepsByAutonomy(steps: string[], level: number): string[] {
  if (level === 1) return [steps[0]];
  if (level === 2) return steps.slice(0, 4);
  return steps;
}

function getAgentForAction(action: string): string {
  const map: Record<string, string> = {
    'search_lead':             'prospector',
    'lead_intelligence_360':   'lead_intelligence',
    'enrich_lead':             'enrichment',        // legado
    'score_lead':              'scoring',           // legado
    'generate_outreach':       'outreach',
    'create_crm_opportunity':  'crm'
  };
  return map[action] ?? 'unknown';
}

function buildStepInput(
  action: string,
  goal: GoalInferenceResult,
  resolved: Record<string, unknown>,
  memory: SessionMemory
): Record<string, unknown> {
  if (action === 'search_lead') return { filters: goal.filters };
  if (action === 'lead_intelligence_360') return { lead: resolved['target_lead'] ?? memory.lastLead };
  if (action === 'enrich_lead') return { lead: resolved['target_lead'] ?? memory.lastLead };
  if (action === 'score_lead')  return { lead: memory.lastEnrichedLead ?? memory.lastLead };
  if (action === 'generate_outreach') return { lead: memory.lastEnrichedLead ?? memory.lastLead };
  if (action === 'create_crm_opportunity') return { lead: memory.lastEnrichedLead ?? memory.lastLead };
  return {};
}

function estimateCost(steps: string[]): number {
  const costPerStep: Record<string, number> = {
    'search_lead':            0.0003,
    'lead_intelligence_360':  0.0006,  // 2× Haiku + 1× Sonnet synthesis
    'enrich_lead':            0.0004,
    'score_lead':             0.0001,
    'generate_outreach':      0.0040,
    'create_crm_opportunity': 0.0000
  };
  return steps.reduce((total, s) => total + (costPerStep[s] ?? 0), 0);
}
