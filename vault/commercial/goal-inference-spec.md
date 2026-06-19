---
title: Goal Inference - Especificação
type: implementation-spec
module: goal-inference
status: implementation-ready
version: 1.0
created: 2026-06-18
tags: [vraxia, sense, goal-inference, orquestrador, proativo]
depends_on: [commercial-sense-spec, session-memory-spec]
---

# Goal Inference — Especificação

> Define como o VRAXIA Sense infere o objetivo real por trás de um
> pedido literal do usuário. Este é o componente central que diferencia
> o Commercial Sense de um chatbot comum.

## 1. Princípio Fundamental

O usuário raramente pede o que realmente precisa.

```
PEDIDO LITERAL:        "Me traga um diretor de marketing em telecom"
OBJETIVO REAL:         Gerar oportunidade comercial qualificada
PIPELINE NECESSÁRIO:   Buscar → Enriquecer → Pontuar → Outreach → CRM
```

A função do Goal Inference é descobrir o objetivo real
e montar o plano de execução completo antes de agir.

## 2. Mapa de Intenções → Objetivos

```typescript
// agents/sense/goalInference.ts

const INTENT_TO_GOAL: Record<string, string> = {
  // Pedidos de busca
  'buscar_lead':        'create_sales_opportunity',
  'encontrar_contato':  'create_sales_opportunity',
  'achar_decisor':      'create_sales_opportunity',

  // Pedidos de enriquecimento
  'enriquecer_lead':    'qualify_and_outreach',
  'detalhar_lead':      'qualify_and_outreach',

  // Pedidos de abordagem
  'gerar_outreach':     'execute_outreach',
  'criar_mensagem':     'execute_outreach',

  // Pedidos de pipeline
  'criar_oportunidade': 'close_pipeline',
  'abrir_crm':          'close_pipeline',
};

const GOAL_TO_STEPS: Record<string, string[]> = {
  'create_sales_opportunity': [
    'search_lead',
    'enrich_lead',
    'score_lead',
    'generate_outreach',
    'create_crm_opportunity'
  ],
  'qualify_and_outreach': [
    'enrich_lead',
    'score_lead',
    'generate_outreach'
  ],
  'execute_outreach': [
    'generate_outreach',
    'create_crm_opportunity'
  ],
  'close_pipeline': [
    'create_crm_opportunity'
  ]
};
```

## 3. Prompt de Goal Inference

Modelo: Haiku | Max output: 150 tokens | Input: request + estado atual

```typescript
// prompts/commercial/goalInferencePrompt.ts

export const GOAL_INFERENCE_PROMPT = `
Você é o motor de inferência de objetivos do VRAXIA Sense.

Analise o pedido do usuário e retorne JSON puro (sem markdown):
{
  "intent": "string",
  "goal": "create_sales_opportunity"|"qualify_and_outreach"|"execute_outreach"|"close_pipeline",
  "steps": ["search_lead","enrich_lead","score_lead","generate_outreach","create_crm_opportunity"],
  "filters": {
    "industry": "string|null",
    "department": "string|null",
    "position": "string|null",
    "location": "string|null"
  },
  "confidence": 0.0-1.0
}

REGRAS:
- Se o usuário pediu busca de lead → goal sempre é create_sales_opportunity
- Se o usuário pediu enriquecimento → goal é qualify_and_outreach
- Inclua apenas os steps necessários para o goal inferido
- filters extraídos diretamente do texto (null se não mencionado)
- confidence < 0.7 → incluir step de confirmação antes de executar
`.trim();
```

## 4. Implementação do Goal Inference

```typescript
// agents/sense/goalInference.ts

import Anthropic from '@anthropic-ai/sdk';
import { GOAL_INFERENCE_PROMPT } from '../../prompts/commercial/goalInferencePrompt';
import type { SessionMemory } from '../../memory/sessionMemory';
import type { ExecutionPlan, SearchFilters } from '../../types/commercial';

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

  const raw = response.content[0].type === 'text'
    ? response.content[0].text.trim()
    : '{}';

  try {
    return JSON.parse(raw) as GoalInferenceResult;
  } catch {
    // Fallback seguro — assume busca de lead genérica
    return {
      intent: 'buscar_lead',
      goal: 'create_sales_opportunity',
      steps: ['search_lead'],
      filters: {},
      confidence: 0.5
    };
  }
}
```

## 5. SenseOrchestrator — Orquestrador Central

```typescript
// agents/sense/senseOrchestrator.ts

import { inferGoal } from './goalInference';
import { resolveReferences } from '../commercial/contextResolver';
import { transition, CommercialState } from '../commercial/stateMachine';
import { createExecutionPlan } from '../commercial/actionPlanner';
import { runExecutionQueue } from '../../workers/executionQueue';
import { updateMemory, summarizeIfNeeded } from '../../memory/sessionMemory';
import { AUTONOMY_CONFIG } from '../../config/autonomyConfig';
import type { SessionMemory } from '../../memory/sessionMemory';

export interface OrchestratorResult {
  response: Record<string, unknown>;
  next_action?: string;
  updated_memory: SessionMemory;
  plan_executed: string[];
}

export async function runCommercialSense(
  userRequest: string,
  memory: SessionMemory
): Promise<OrchestratorResult> {

  // PASSO 1 — Resolver referências contextuais (custo zero)
  const resolved = resolveReferences(userRequest, memory);
  console.log('[Sense] Referências resolvidas:', resolved);

  // PASSO 2 — Inferir objetivo real (Haiku, 150 tokens)
  const goalResult = await inferGoal(userRequest, memory);
  console.log('[Sense] Objetivo inferido:', goalResult.goal, 'confidence:', goalResult.confidence);

  // PASSO 3 — Se confiança baixa e nível 1, confirmar com usuário
  if (goalResult.confidence < 0.7 && AUTONOMY_CONFIG.level === 1) {
    return {
      response: {
        message: `Quero executar: ${goalResult.steps.join(' → ')}. Confirma?`,
        goal: goalResult.goal,
        steps: goalResult.steps
      },
      next_action: 'await_confirmation',
      updated_memory: memory,
      plan_executed: []
    };
  }

  // PASSO 4 — Criar plano de execução (Haiku, 200 tokens)
  const plan = await createExecutionPlan(goalResult, resolved, memory);

  // PASSO 5 — Executar pipeline conforme nível de autonomia
  const result = await runExecutionQueue(plan, memory, AUTONOMY_CONFIG.level);

  // PASSO 6 — Atualizar memória (custo zero)
  let updatedMemory = updateMemory(memory, result, goalResult);

  // PASSO 7 — Summary se necessário (Haiku, 300 tokens, a cada 10 msgs)
  updatedMemory = await summarizeIfNeeded(updatedMemory);

  return {
    response: result.output,
    next_action: result.next_action,
    updated_memory: updatedMemory,
    plan_executed: plan.steps.map(s => s.action)
  };
}
```

## 6. Action Planner

```typescript
// agents/commercial/actionPlanner.ts
// Transforma GoalInferenceResult em ExecutionPlan concreto.
// Modelo: Haiku | Max output: 200 tokens

import Anthropic from '@anthropic-ai/sdk';
import { AUTONOMY_CONFIG } from '../../config/autonomyConfig';
import type { GoalInferenceResult } from '../sense/goalInference';
import type { ExecutionPlan, PipelineStep } from '../../types/commercial';
import type { SessionMemory } from '../../memory/sessionMemory';

const client = new Anthropic();

export async function createExecutionPlan(
  goal: GoalInferenceResult,
  resolved: Record<string, unknown>,
  memory: SessionMemory
): Promise<ExecutionPlan> {

  // Filtrar steps pelo nível de autonomia
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

function filterStepsByAutonomy(steps: string[], level: number): string[] {
  if (level === 1) return [steps[0]];      // Só o primeiro passo
  if (level === 2) return steps.slice(0, 4); // Até outreach, sem CRM
  return steps;                              // Todos os steps (nível 3)
}

function getAgentForAction(action: string): string {
  const map: Record<string, string> = {
    'search_lead':             'prospector',
    'enrich_lead':             'enrichment',
    'score_lead':              'scoring',
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
  if (action === 'enrich_lead') return { lead: resolved.target_lead ?? memory.lastLead };
  if (action === 'score_lead')  return { lead: memory.lastEnrichedLead ?? memory.lastLead };
  if (action === 'generate_outreach') return { lead: memory.lastEnrichedLead ?? memory.lastLead };
  if (action === 'create_crm_opportunity') return { lead: memory.lastEnrichedLead ?? memory.lastLead };
  return {};
}

function estimateCost(steps: string[]): number {
  const costPerStep: Record<string, number> = {
    'search_lead':            0.0003,
    'enrich_lead':            0.0004,
    'score_lead':             0.0001,
    'generate_outreach':      0.0012,
    'create_crm_opportunity': 0.0000
  };
  return steps.reduce((total, s) => total + (costPerStep[s] ?? 0), 0);
}
```

## 7. Ver também

- [[commercial-sense-spec]]
- [[session-memory-spec]]
- [[execution-pipeline-spec]]
