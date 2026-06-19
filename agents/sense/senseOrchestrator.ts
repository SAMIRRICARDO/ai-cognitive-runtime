import { inferGoal, type GoalInferenceResult } from './goalInference.js';
import { resolveReferences } from '../commercial/contextResolver.js';
import { createExecutionPlan } from '../commercial/actionPlanner.js';
import { runExecutionQueue } from '../../workers/executionQueue.js';
import { updateMemory, summarizeIfNeeded } from '../../memory/sessionMemory.js';
import { formatResponse } from '../commercial/responseFormatter.js';
import { AUTONOMY_CONFIG } from '../../config/autonomyConfig.js';
import type { SessionMemory } from '../../memory/sessionMemory.js';
import type { SearchFilters } from '../../types/commercial.js';

export interface OrchestratorResult {
  response: Record<string, unknown>;
  formatted_response: string;
  next_action?: string;
  updated_memory: SessionMemory;
  plan_executed: string[];
}

// Só pede confirmação para ações que têm custo ou impacto externo
const GOALS_REQUIRING_CONFIRMATION = ['execute_outreach', 'close_pipeline'];

// Detecta continuação de pipeline sem chamar LLM — custo zero
function detectPipelineContinuation(text: string, memory: SessionMemory): GoalInferenceResult | null {
  const lower = text.toLowerCase();
  const filters: SearchFilters = memory.lastSearchFilters ?? {};

  const hasLead = !!(memory.lastLead ?? (memory.lastLeads && memory.lastLeads.length > 0));
  const inPipeline = memory.currentState !== 'IDLE';

  // Intelligence 360° explícita (enriquecimento, análise, perfil, inteligência)
  if ((hasLead || inPipeline) && /enriquecer|enriquece|detalhar|detalhes|mais info|sobre (ele|ela|o lead)|perfil|analisa|intelig[êe]ncia|360/.test(lower)) {
    return { intent: 'lead_intelligence_360', goal: 'qualify_and_outreach', steps: ['lead_intelligence_360', 'generate_outreach', 'create_crm_opportunity'], filters, confidence: 0.95 };
  }

  // Outreach explícito
  if ((hasLead || inPipeline) && /abordar|outreach|mensagem|email|entrar em contato|contatar/.test(lower)) {
    return { intent: 'gerar_outreach', goal: 'execute_outreach', steps: ['generate_outreach', 'create_crm_opportunity'], filters, confidence: 0.95 };
  }

  // Confirmação de pendingGoal ou continuação genérica
  if (/\b(sim|confirma|pode|continua|continue|próximo|prossegue|vai|executa|ok)\b/.test(lower)) {
    // Usar pendingGoal se existir
    if (memory.pendingGoal) {
      return { ...memory.pendingGoal, confidence: 0.95 };
    }
    // Ou derivar próximo passo do lastAction
    if (memory.lastAction) {
      const next = getNextStepsFromLastAction(memory.lastAction, memory);
      if (next) return next;
    }
  }

  return null;
}

const STEP_SEQUENCE = ['search_lead', 'lead_intelligence_360', 'generate_outreach', 'create_crm_opportunity'];
const STEP_GOAL: Record<string, string> = {
  'lead_intelligence_360':  'qualify_and_outreach',
  'generate_outreach':      'execute_outreach',
  'create_crm_opportunity': 'close_pipeline'
};

function getNextStepsFromLastAction(lastAction: string, memory: SessionMemory): GoalInferenceResult | null {
  const idx = STEP_SEQUENCE.indexOf(lastAction);
  if (idx === -1 || idx >= STEP_SEQUENCE.length - 1) return null;
  const remaining = STEP_SEQUENCE.slice(idx + 1);
  return {
    intent: 'continuar_pipeline',
    goal: STEP_GOAL[remaining[0]] ?? 'qualify_and_outreach',
    steps: remaining,
    filters: memory.lastSearchFilters ?? {},
    confidence: 0.95
  };
}

const GREETING_PATTERN = /^(ol[aá]|oi|hey|e a[ií]|bom dia|boa tarde|boa noite|tudo bem|tudo bom|salve|fala)\b/i;

function makeGreetingResponse(memory: SessionMemory): OrchestratorResult {
  const hasContext = !!(memory.lastLead ?? memory.lastLeads?.length);
  const msg = hasContext
    ? `Olá! Estou com **${memory.lastLead?.name ?? 'o lead anterior'}** em memória.\n\nPosso analisar, gerar outreach ou buscar novos leads. O que deseja?`
    : `Olá! Sou o SDR da VRASHOWS.\n\nPosso te ajudar a:\n• 🔍 Buscar leads qualificados\n• 🧠 Analisar inteligência completa de um contato\n• ✉️ Gerar outreach personalizado\n\nComo começamos?`;
  return {
    response: {},
    formatted_response: msg,
    next_action: undefined,
    updated_memory: memory,
    plan_executed: []
  };
}

export async function runCommercialSense(
  userRequest: string,
  memory: SessionMemory
): Promise<OrchestratorResult> {
  // Saudações — resposta direta, sem LLM
  if (GREETING_PATTERN.test(userRequest.trim())) {
    return makeGreetingResponse(memory);
  }

  // PASSO 1 — Resolver referências contextuais (custo zero)
  const resolved = resolveReferences(userRequest, memory);
  console.log('[Sense] Estado:', memory.currentState, '| lastLead:', memory.lastLead?.name ?? 'none', '| lastAction:', memory.lastAction ?? 'none');

  // PASSO 2 — Detectar continuação de pipeline sem LLM (custo zero)
  const continuation = detectPipelineContinuation(userRequest, memory);
  if (continuation) {
    console.log('[Sense] Continuação detectada (zero-cost):', continuation.intent, '→', continuation.steps);
  }

  // PASSO 3 — Inferir objetivo via Haiku só se não for continuação óbvia
  const goalResult = continuation ?? await inferGoal(userRequest, memory);
  if (!continuation) {
    console.log('[Sense] Objetivo inferido:', goalResult.goal, 'confidence:', goalResult.confidence);
  }

  // PASSO 4 — Só bloqueia por confiança baixa para ações com impacto externo
  const needsConfirmation = goalResult.confidence < 0.7
    && AUTONOMY_CONFIG.level === 1
    && GOALS_REQUIRING_CONFIRMATION.includes(goalResult.goal);

  if (needsConfirmation) {
    const memWithPending: SessionMemory = { ...memory, pendingGoal: goalResult };
    const confirmOutput = {
      message: `Quero executar: ${goalResult.steps.join(' → ')}. Confirma?`,
      goal: goalResult.goal,
      steps: goalResult.steps
    };
    return {
      response: confirmOutput,
      formatted_response: formatResponse(confirmOutput, []),
      next_action: 'await_confirmation',
      updated_memory: memWithPending,
      plan_executed: []
    };
  }

  // PASSO 5 — Criar plano de execução (determinístico, custo zero)
  // Limpa pendingGoal após usar
  const cleanMemory: SessionMemory = { ...memory, pendingGoal: undefined };
  const plan = await createExecutionPlan(goalResult, resolved, cleanMemory);

  // PASSO 6 — Executar pipeline conforme nível de autonomia
  const result = await runExecutionQueue(plan, cleanMemory, AUTONOMY_CONFIG.level);

  // PASSO 7 — Atualizar memória com transições de estado corretas (custo zero)
  let updatedMemory = updateMemory(cleanMemory, result, goalResult);

  // PASSO 8 — Summary se necessário (Haiku, 300 tokens, a cada 10 msgs)
  updatedMemory = await summarizeIfNeeded(updatedMemory);

  console.log('[Sense] Novo estado:', updatedMemory.currentState, '| lead em memória:', updatedMemory.lastLead?.name ?? 'none');

  const formattedResponse = formatResponse(result.output, result.steps_executed);

  return {
    response: result.output,
    formatted_response: formattedResponse,
    next_action: result.next_action,
    updated_memory: updatedMemory,
    plan_executed: result.steps_executed
  };
}
