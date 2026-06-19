---
title: Session Memory - Especificação
type: implementation-spec
module: session-memory
status: implementation-ready
version: 1.0
created: 2026-06-18
tags: [vraxia, memoria, session, state-machine, context]
depends_on: [commercial-sense-spec]
---

# Session Memory — Especificação

> Define a estrutura de memória conversacional e a máquina de estados
> do módulo comercial. Consultar antes de implementar sessionMemory.ts,
> contextResolver.ts e stateMachine.ts.

## 1. Estrutura da Session Memory

```typescript
// memory/sessionMemory.ts

export interface SessionMemory {
  sessionId: string;
  createdAt: string;
  updatedAt: string;

  // Estado atual da conversa
  currentState: CommercialState;
  lastIntent?: string;
  lastAction?: string;

  // Contexto de busca
  lastIndustry?: string;
  lastDepartment?: string;
  lastPosition?: string;
  lastLocation?: string;
  lastCompanySize?: string;
  lastSearchFilters?: SearchFilters;

  // Leads em memória
  lastLeads?: Lead[];
  lastLead?: Lead;
  lastEnrichedLead?: Lead;

  // Contexto de campanha
  lastOutreach?: {
    email?: string;
    linkedin?: string;
    whatsapp?: string;
    cold_call_script?: string;
  };

  // CRM
  lastOpportunityId?: string;

  // Resumo comprimido (gerado a cada 10 mensagens)
  conversationSummary?: string;
  messageCount: number;
}
```

## 2. Estado Inicial

```typescript
export function createEmptySession(sessionId: string): SessionMemory {
  return {
    sessionId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentState: CommercialState.IDLE,
    messageCount: 0
  };
}
```

## 3. State Machine — Estados

```typescript
export enum CommercialState {
  IDLE                = 'IDLE',
  SEARCHING_LEADS     = 'SEARCHING_LEADS',
  LEADS_FOUND         = 'LEADS_FOUND',
  LEADS_ENRICHED      = 'LEADS_ENRICHED',
  LEADS_SCORED        = 'LEADS_SCORED',
  OUTREACH_GENERATED  = 'OUTREACH_GENERATED',
  OPPORTUNITY_CREATED = 'OPPORTUNITY_CREATED'
}
```

## 4. State Machine — Transições Válidas

Regra: a State Machine é determinística. Zero chamadas de API.
Apenas valida se a transição é permitida.

```typescript
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
    console.warn(
      `[StateMachine] Transição inválida: ${memory.currentState} → ${to}`
    );
    return memory;
  }
  return {
    ...memory,
    currentState: to,
    updatedAt: new Date().toISOString()
  };
}
```

## 5. Context Resolver — Tabela de Referências

O Context Resolver é determinístico. Zero chamadas de API.
Resolve referências humanas vagas para entidades concretas da memória.

```typescript
// agents/commercial/contextResolver.ts

export function resolveReferences(
  input: string,
  memory: SessionMemory
): Record<string, unknown> {
  const text = input.toLowerCase();
  const resolved: Record<string, unknown> = {};

  // Referências a leads
  if (text.includes('esse lead') || text.includes('ele') || text.includes('ela')) {
    resolved.target_lead = memory.lastLead;
  }
  if (text.includes('esses leads') || text.includes('eles') || text.includes('elas')) {
    resolved.target_leads = memory.lastLeads;
  }
  if (text.includes('o primeiro') || text.includes('primeiro lead')) {
    resolved.target_lead = memory.lastLeads?.[0];
  }
  if (text.includes('o segundo') || text.includes('segundo lead')) {
    resolved.target_lead = memory.lastLeads?.[1];
  }
  if (text.includes('o terceiro')) {
    resolved.target_lead = memory.lastLeads?.[2];
  }

  // Referências a empresa
  if (text.includes('essa empresa') || text.includes('a empresa')) {
    resolved.target_company = memory.lastLead?.company;
  }

  // Referências a ações anteriores
  if (text.includes('continue') || text.includes('continua') || text.includes('próximo')) {
    resolved.continue_from = memory.lastAction;
    resolved.current_state = memory.currentState;
  }

  // Referências a filtros anteriores
  if (text.includes('mesmo segmento') || text.includes('mesma área')) {
    resolved.reuse_filters = memory.lastSearchFilters;
  }

  return resolved;
}
```

## 6. Persistência — Long-term Memory

Estrutura de banco de dados relacional (PostgreSQL, já existente no runtime):

```sql
-- Tabelas necessárias

CREATE TABLE conversation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR(255) UNIQUE NOT NULL,
  user_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE conversation_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR(255) REFERENCES conversation_sessions(session_id),
  memory_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE conversation_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR(255) REFERENCES conversation_sessions(session_id),
  summary_text TEXT NOT NULL,
  message_count_at_summary INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE lead_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR(255),
  lead_json JSONB NOT NULL,
  score INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 7. Conversation Summary — Quando e Como

Regra: a cada 10 mensagens, gerar um resumo comprimido e salvar.
Objetivo: manter contexto mesmo após 200+ mensagens sem explodir tokens.

```typescript
// Prompt de summary — deve ser curto (output max 300 tokens)
export const SUMMARY_PROMPT = `
Gere um resumo comprimido da conversa comercial.
Inclua: objetivo do usuário, leads encontrados, estado atual, próximos passos.
Máximo 5 linhas. Retorne texto puro, sem markdown.
`.trim();
```

Quando `memory.messageCount % 10 === 0`:
1. Chamar Haiku com SUMMARY_PROMPT + histórico recente
2. Salvar resultado em `memory.conversationSummary`
3. Persistir na tabela `conversation_summaries`
4. Incluir o summary no contexto das próximas chamadas (não o histórico completo)

## 8. O que a RAG guarda vs o que a Session Memory guarda

| RAG (Obsidian vault) | Session Memory |
|---|---|
| Playbook de outbound | Leads encontrados nesta conversa |
| ICP por segmento | Estado atual da conversa |
| Cases de sucesso | Filtros usados na busca |
| Estratégia de abordagem | Outreach gerado |
| Histórico corporativo | Oportunidade criada no CRM |

Regra: RAG é conhecimento permanente. Session Memory é contexto temporário.

## 9. Ver também

- [[commercial-sense-spec]]
- [[goal-inference-spec]]
- [[execution-pipeline-spec]]
