import { runProspector } from '../agents/commercial/prospector.js';
import { runLeadIntelligence360 } from '../agents/commercial/leadIntelligence.js';
import { runEnrichment } from '../agents/commercial/enrichment.js';
import { runScoring } from '../agents/commercial/scoring.js';
import { runOutreach } from '../agents/commercial/outreach.js';
import { runCRM } from '../agents/commercial/crm.js';
import type { ExecutionPlan, AgentOutput } from '../types/commercial.js';
import type { SessionMemory } from '../memory/sessionMemory.js';

type AgentFn = (input: Record<string, unknown>, memory: SessionMemory) => Promise<AgentOutput>;

const AGENT_MAP: Record<string, AgentFn> = {
  prospector:          runProspector as AgentFn,
  lead_intelligence:   runLeadIntelligence360 as AgentFn,
  enrichment:          runEnrichment as AgentFn,   // mantido para compatibilidade
  scoring:             runScoring as AgentFn,       // mantido para compatibilidade
  outreach:            runOutreach as AgentFn,
  crm:                 runCRM as AgentFn
};

export interface QueueResult {
  output: Record<string, unknown>;
  next_action?: string;
  steps_executed: string[];
  steps_skipped: string[];
}

export async function runExecutionQueue(
  plan: ExecutionPlan,
  memory: SessionMemory,
  autonomyLevel: number
): Promise<QueueResult> {
  const stepsExecuted: string[] = [];
  const stepsSkipped: string[] = [];
  let currentInput: Record<string, unknown> = {};
  let lastOutput: AgentOutput = { success: true, data: {} };

  for (const step of plan.steps) {
    console.log(`[Queue] Executando: ${step.agent}.${step.action}`);

    const agentFn = AGENT_MAP[step.agent];
    if (!agentFn) {
      console.warn(`[Queue] Agente desconhecido: ${step.agent}`);
      stepsSkipped.push(step.action);
      continue;
    }

    const input = { ...(step.input ?? {}), ...currentInput };
    lastOutput = await agentFn(input, memory);

    if (!lastOutput.success) {
      console.error(`[Queue] Falha em ${step.action}:`, lastOutput.error);
      stepsSkipped.push(step.action);
      break;
    }

    stepsExecuted.push(step.action);
    currentInput = lastOutput.data;

    if (autonomyLevel === 1 && stepsExecuted.length === 1) {
      const remainingSteps = plan.steps
        .slice(stepsExecuted.length)
        .map(s => s.action);
      return {
        output: {
          ...lastOutput.data,
          awaiting_confirmation: true,
          next_steps_available: remainingSteps
        },
        next_action: 'await_confirmation',
        steps_executed: stepsExecuted,
        steps_skipped: stepsSkipped
      };
    }
  }

  return {
    output: lastOutput.data,
    next_action: lastOutput.next_action,
    steps_executed: stepsExecuted,
    steps_skipped: stepsSkipped
  };
}
