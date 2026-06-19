---
title: Execution Pipeline - Especificação
type: implementation-spec
module: execution-pipeline
status: implementation-ready
version: 1.0
created: 2026-06-18
tags: [vraxia, pipeline, agentes, execucao, comercial]
depends_on: [commercial-sense-spec, goal-inference-spec]
---

# Execution Pipeline — Especificação

> Define os 5 agentes de execução do pipeline comercial e o
> Execution Queue que os orquestra. Cada agente tem input e
> output estruturado — nunca texto livre.

## 1. Regra de Ouro dos Agentes

NUNCA retornar texto livre.
SEMPRE retornar JSON estruturado.

ERRADO:  "Achei o Rodrigo Shimizu na Oi."
CERTO:   { "lead_id": "lead_001", "name": "Rodrigo Shimizu", "company": "Oi" }

## 2. Execution Queue — Orquestrador dos Agentes

```typescript
// workers/executionQueue.ts

import { runProspector } from '../agents/commercial/prospector';
import { runEnrichment } from '../agents/commercial/enrichment';
import { runScoring } from '../agents/commercial/scoring';
import { runOutreach } from '../agents/commercial/outreach';
import { runCRM } from '../agents/commercial/crm';
import type { ExecutionPlan, AgentOutput } from '../types/commercial';
import type { SessionMemory } from '../memory/sessionMemory';

const AGENT_MAP: Record<string, Function> = {
  prospector: runProspector,
  enrichment: runEnrichment,
  scoring:    runScoring,
  outreach:   runOutreach,
  crm:        runCRM
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
  let currentInput = {};
  let lastOutput: AgentOutput = { success: true, data: {} };

  for (const step of plan.steps) {
    console.log(`[Queue] Executando: ${step.agent}.${step.action}`);

    const agentFn = AGENT_MAP[step.agent];
    if (!agentFn) {
      console.warn(`[Queue] Agente desconhecido: ${step.agent}`);
      stepsSkipped.push(step.action);
      continue;
    }

    // Mesclar input do step com output do passo anterior
    const input = { ...step.input, ...currentInput };
    lastOutput = await agentFn(input, memory);

    if (!lastOutput.success) {
      console.error(`[Queue] Falha em ${step.action}:`, lastOutput.error);
      stepsSkipped.push(step.action);
      break;
    }

    stepsExecuted.push(step.action);
    currentInput = lastOutput.data; // output vira input do próximo

    // Se nível 1, para após primeiro step e pergunta
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
```

## 3. Agente 1 — Prospector

```typescript
// agents/commercial/prospector.ts
// Busca leads com base nos filtros extraídos pelo Goal Inference.
// Modelo: Haiku | Max output: 256 tokens

import Anthropic from '@anthropic-ai/sdk';
import type { SearchFilters, Lead, AgentOutput } from '../../types/commercial';
import type { SessionMemory } from '../../memory/sessionMemory';

const client = new Anthropic();

export async function runProspector(
  input: { filters: SearchFilters },
  memory: SessionMemory
): Promise<AgentOutput> {

  // Incluir contexto do vault/RAG se disponível
  const ragContext = memory.conversationSummary ?? '';

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: `
Você é o agente de prospecção do VRAXIA.
Retorne JSON puro com array de leads encontrados.
Formato: { "leads": [{ "id": "lead_001", "name": "...", "company": "...", "role": "...", "linkedin_url": "..." }] }
Máximo 5 leads. Sem texto adicional.
${ragContext ? 'Contexto: ' + ragContext : ''}
    `.trim(),
    messages: [{
      role: 'user',
      content: `Buscar: ${JSON.stringify(input.filters)}`
    }]
  });

  const raw = response.content[0].type === 'text'
    ? response.content[0].text.trim() : '{}';

  try {
    const parsed = JSON.parse(raw);
    return {
      success: true,
      data: parsed,
      next_action: 'enrich_lead'
    };
  } catch {
    return { success: false, data: {}, error: 'Erro no parsing dos leads' };
  }
}
```

## 4. Agente 2 — Enrichment

```typescript
// agents/commercial/enrichment.ts
// Enriquece lead com dados adicionais: LinkedIn, histórico, notícias.
// Modelo: Haiku | Max output: 400 tokens
// Só executa se score anterior > 60 (definido no scoring)

import Anthropic from '@anthropic-ai/sdk';
import type { Lead, AgentOutput } from '../../types/commercial';
import type { SessionMemory } from '../../memory/sessionMemory';

const client = new Anthropic();

export async function runEnrichment(
  input: { lead: Lead },
  memory: SessionMemory
): Promise<AgentOutput> {

  if (!input.lead) {
    return { success: false, data: {}, error: 'Lead não fornecido para enriquecimento' };
  }

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: `
Você é o agente de enriquecimento do VRAXIA.
Retorne JSON puro com dados enriquecidos do lead.
Formato: {
  "lead_id": "...",
  "name": "...",
  "company": "...",
  "role": "...",
  "linkedin_url": "...",
  "time_in_role_months": 0,
  "company_size": "...",
  "recent_news": "...",
  "tech_stack": [],
  "pain_points": [],
  "enriched": true
}
Sem texto adicional.
    `.trim(),
    messages: [{
      role: 'user',
      content: `Enriquecer lead: ${JSON.stringify(input.lead)}`
    }]
  });

  const raw = response.content[0].type === 'text'
    ? response.content[0].text.trim() : '{}';

  try {
    const parsed = JSON.parse(raw);
    return {
      success: true,
      data: { lead: { ...input.lead, ...parsed, enriched: true } },
      next_action: 'score_lead'
    };
  } catch {
    return { success: false, data: {}, error: 'Erro no enriquecimento' };
  }
}
```

## 5. Agente 3 — Scoring

```typescript
// agents/commercial/scoring.ts
// Pontua o lead de 0 a 100 com base no ICP do vault.
// Modelo: Haiku | Max output: 100 tokens

import Anthropic from '@anthropic-ai/sdk';
import type { Lead, AgentOutput } from '../../types/commercial';
import type { SessionMemory } from '../../memory/sessionMemory';

const client = new Anthropic();

const SCORING_PROMPT = `
Você é o agente de scoring do VRAXIA.
Pontue o lead de 0 a 100 com base no ICP: empresas B2B de médio/grande porte
que participam de eventos corporativos, feiras e convenções.
Retorne JSON puro: { "score": 0-100, "fit": "high"|"medium"|"low", "reason": "string de 10 palavras" }
Sem texto adicional.
`.trim();

export async function runScoring(
  input: { lead: Lead },
  memory: SessionMemory
): Promise<AgentOutput> {

  if (!input.lead) {
    return { success: false, data: {}, error: 'Lead não fornecido para scoring' };
  }

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    system: SCORING_PROMPT,
    messages: [{
      role: 'user',
      content: JSON.stringify(input.lead)
    }]
  });

  const raw = response.content[0].type === 'text'
    ? response.content[0].text.trim() : '{}';

  try {
    const parsed = JSON.parse(raw);
    const shouldContinue = parsed.score >= 60;

    return {
      success: true,
      data: {
        lead: { ...input.lead, score: parsed.score, fit: parsed.fit },
        score: parsed.score,
        fit: parsed.fit,
        score_reason: parsed.reason,
        should_continue: shouldContinue
      },
      next_action: shouldContinue ? 'generate_outreach' : 'skip_low_score'
    };
  } catch {
    return { success: false, data: {}, error: 'Erro no scoring' };
  }
}
```

## 6. Agente 4 — Outreach

```typescript
// agents/commercial/outreach.ts
// Gera mensagens de abordagem personalizadas.
// Modelo: Sonnet (único que usa Sonnet — qualidade é crítica aqui)
// Max output: 800 tokens
// Só executa se score >= 60

import Anthropic from '@anthropic-ai/sdk';
import type { Lead, AgentOutput } from '../../types/commercial';
import type { SessionMemory } from '../../memory/sessionMemory';

const client = new Anthropic();

const OUTREACH_PROMPT = `
Você é o agente de outreach do VRAXIA para a VRASHOWS.
A VRASHOWS oferece operação completa para eventos corporativos:
stand, transfer executivo, logística, recepção, segurança, foto e vídeo.

Gere abordagem personalizada para o lead. Retorne JSON puro:
{
  "linkedin_message": "mensagem curta para LinkedIn (max 300 chars)",
  "whatsapp_message": "mensagem para WhatsApp (max 400 chars)",
  "email_subject": "assunto do email",
  "email_body": "corpo do email (max 200 palavras)",
  "cold_call_script": "roteiro de ligação (max 150 palavras)"
}
Sem texto adicional. Tom: profissional e direto, não genérico.
`.trim();

export async function runOutreach(
  input: { lead: Lead },
  memory: SessionMemory
): Promise<AgentOutput> {

  if (!input.lead) {
    return { success: false, data: {}, error: 'Lead não fornecido para outreach' };
  }

  // Verificar score mínimo
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

  const raw = response.content[0].type === 'text'
    ? response.content[0].text.trim() : '{}';

  try {
    const parsed = JSON.parse(raw);
    return {
      success: true,
      data: {
        lead: input.lead,
        outreach: parsed,
        outreach_generated: true
      },
      next_action: 'create_crm_opportunity'
    };
  } catch {
    return { success: false, data: {}, error: 'Erro na geração de outreach' };
  }
}
```

## 7. Agente 5 — CRM

```typescript
// agents/commercial/crm.ts
// Registra oportunidade. Custo zero — operação determinística.
// Não chama LLM. Apenas estrutura e persiste os dados.

import type { Lead, AgentOutput } from '../../types/commercial';
import type { SessionMemory } from '../../memory/sessionMemory';

export async function runCRM(
  input: { lead: Lead; outreach?: Record<string, unknown> },
  memory: SessionMemory
): Promise<AgentOutput> {

  if (!input.lead) {
    return { success: false, data: {}, error: 'Lead não fornecido para CRM' };
  }

  const opportunity = {
    id: `opp_${Date.now()}`,
    lead_name: input.lead.name,
    company: input.lead.company,
    role: input.lead.role,
    score: input.lead.score ?? 0,
    status: 'new',
    outreach_ready: !!input.outreach,
    created_at: new Date().toISOString(),
    next_action: 'linkedin_contact',
    next_action_date: getNextBusinessDay()
  };

  // TODO: persistir no banco quando CRM real for integrado
  console.log('[CRM] Oportunidade criada:', opportunity.id);

  return {
    success: true,
    data: {
      opportunity,
      lead: input.lead,
      outreach: input.outreach,
      pipeline_complete: true
    },
    next_action: 'notify_manager'
  };
}

function getNextBusinessDay(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  if (date.getDay() === 0) date.setDate(date.getDate() + 1);
  if (date.getDay() === 6) date.setDate(date.getDate() + 2);
  return date.toISOString().split('T')[0];
}
```

## 8. Output Final — O que o usuário recebe

```typescript
// Ao invés de "Achei Rodrigo Shimizu."
// O usuário recebe:

{
  "lead": {
    "name": "Rodrigo Shimizu",
    "company": "Oi",
    "role": "Diretor de Marketing",
    "score": 87,
    "fit": "high",
    "linkedin_url": "...",
    "enriched": true
  },
  "outreach": {
    "linkedin_message": "Olá Rodrigo...",
    "whatsapp_message": "Oi Rodrigo...",
    "email_subject": "Operação de stand para eventos da Oi",
    "email_body": "...",
    "cold_call_script": "..."
  },
  "opportunity": {
    "id": "opp_1718700000000",
    "status": "new",
    "next_action": "linkedin_contact",
    "next_action_date": "2026-06-19"
  },
  "pipeline_complete": true,
  "steps_executed": ["search_lead","enrich_lead","score_lead","generate_outreach","create_crm_opportunity"]
}
```

## 9. Config de Autonomia

```typescript
// config/autonomyConfig.ts

export const AUTONOMY_CONFIG = {
  level: 1 as 1 | 2 | 3,
  // 1 = Sugere próximo passo, aguarda confirmação
  // 2 = Executa até outreach, para antes do CRM
  // 3 = Pipeline completo sem parar

  score_threshold: 60,
  // Leads abaixo desse score são descartados antes do outreach

  max_leads_per_search: 5,
  // Limite de leads por busca para controle de custo

  summary_interval: 10
  // Gerar conversation summary a cada N mensagens
};
```

## 10. Checklist de Validação para o Claude Code

Após criar todos os arquivos:

1. npx tsc --noEmit deve passar sem erros
2. Nenhum agente chama API sem ter recebido input válido
3. CRM agent não faz chamada de rede (só log + estrutura)
4. Scoring agent descarta lead < 60 e sinaliza skip
5. Outreach agent usa claude-sonnet-4-6 (único com Sonnet)
6. Todos os demais agentes usam claude-haiku-4-5-20251001
7. Nenhum output de agente é texto livre — sempre JSON
8. autonomyConfig.ts é a única fonte de verdade para o nível

## 11. Ver também

- [[commercial-sense-spec]]
- [[session-memory-spec]]
- [[goal-inference-spec]]
