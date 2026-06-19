---
title: Commercial Sense - Especificação de Arquitetura
type: architecture-spec
module: commercial-sense
status: implementation-ready
version: 1.0
created: 2026-06-18
tags: [vraxia, sense, comercial, arquitetura, orquestrador]
---

# Commercial Sense — Especificação de Arquitetura

> Documento primário de referência para RAG e Claude Code.
> Leia este documento antes de qualquer implementação do módulo comercial.

## 1. Conceito Central

O Commercial Sense transforma o agente comercial de um chatbot reativo
em um operador comercial autônomo.

A diferença fundamental:

CHATBOT REATIVO:
Usuário pede → IA executa o pedido → aguarda próximo pedido

COMMERCIAL SENSE:
Usuário pede → Sense infere objetivo real →
monta pipeline completo → executa → entrega resultado pronto

O Sense não responde ao pedido literal.
Ele responde ao objetivo implícito por trás do pedido.

## 2. Sete Camadas da Arquitetura

```
CAMADA 1 — ENTRADA
User Request (texto livre)
        ↓
CAMADA 2 — SENSE LAYER
Intent Detection + Goal Inference
        ↓
CAMADA 3 — CONTEXT LAYER
Session Memory + Context Resolver + State Machine
        ↓
CAMADA 4 — PLANNING LAYER
Action Planner + Execution Queue + Autonomy Controller
        ↓
CAMADA 5 — EXECUTION LAYER
Prospector → Enrichment → Scoring → Outreach → CRM
        ↓
CAMADA 6 — MEMORY LAYER
Session Memory Update + Long-term DB + Conversation Summary
        ↓
CAMADA 7 — RESPONSE LAYER
Output estruturado JSON + próxima ação recomendada
```

## 3. Governança de Tokens por Camada

Regra não-negociável: camadas determinísticas NUNCA chamam API.

| Camada | Modelo | Max Output Tokens | Frequência |
|---|---|---|---|
| Goal Inference | Haiku | 150 | 1x por request |
| Context Resolver | Zero (determinístico) | 0 | Sempre |
| State Machine | Zero (determinístico) | 0 | Sempre |
| Action Planner | Haiku | 200 | 1x por request |
| Prospector | Haiku | 256 | 1x por lead |
| Enrichment | Haiku | 400 | Só se score > 60 |
| Scoring | Haiku | 100 | 1x por lead |
| Outreach | Sonnet | 800 | Só após score aprovado |
| CRM | Zero (determinístico) | 0 | Sempre |
| Conversation Summary | Haiku | 300 | A cada 10 mensagens |

Custo estimado por pipeline completo: < $0.003 por prospect.

## 4. Estrutura de Arquivos

```
ai-cognitive-runtime/
├── agents/
│   ├── commercial/
│   │   ├── contextResolver.ts
│   │   ├── stateMachine.ts
│   │   ├── actionPlanner.ts
│   │   ├── prospector.ts
│   │   ├── enrichment.ts
│   │   ├── scoring.ts
│   │   ├── outreach.ts
│   │   └── crm.ts
│   └── sense/
│       ├── goalInference.ts
│       └── senseOrchestrator.ts
├── memory/
│   └── sessionMemory.ts
├── workers/
│   └── executionQueue.ts
├── config/
│   └── autonomyConfig.ts
├── prompts/
│   └── commercial/
│       ├── goalInferencePrompt.ts
│       ├── actionPlannerPrompt.ts
│       ├── scoringPrompt.ts
│       └── outreachPrompt.ts
└── types/
    └── commercial.ts
```

## 5. Nível de Autonomia

```typescript
enum AutonomyLevel {
  SUGGEST = 1,  // Sugere próximo passo, aguarda confirmação
  EXECUTE = 2,  // Executa até outreach, para antes do CRM
  FULL    = 3   // Pipeline completo sem parar
}
```

Default inicial: AutonomyLevel.SUGGEST
Nunca hardcodar o nível dentro dos agentes.
Sempre ler de autonomyConfig.ts.

## 6. Tipos Globais — types/commercial.ts

```typescript
export interface Lead {
  id: string;
  name: string;
  company: string;
  role: string;
  linkedin_url?: string;
  email?: string;
  phone?: string;
  score?: number;
  enriched?: boolean;
}

export interface SearchFilters {
  industry?: string;
  department?: string;
  position?: string;
  location?: string;
  company_size?: string;
}

export interface ExecutionPlan {
  goal: string;
  steps: PipelineStep[];
  autonomy_level: number;
  estimated_cost_usd: number;
}

export interface PipelineStep {
  agent: string;
  action: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'error';
}

export interface AgentOutput {
  success: boolean;
  data: Record<string, unknown>;
  next_action?: string;
  error?: string;
}
```

## 7. Regras para o Claude Code

1. Nunca modificar classifierAgent.ts — apenas importar
2. Nunca duplicar lógica de notificação — sempre importar tools/telegram.ts
3. Context Resolver e State Machine NUNCA fazem chamadas de rede
4. Todos os outputs de agentes são JSON estruturado — nunca texto livre
5. Rodar npx tsc --noEmit após cada arquivo criado
6. Autonomy level sempre lido de config/autonomyConfig.ts
7. Session Memory sempre persistida após cada ação de agente

## 8. Ver também

- [[session-memory-spec]]
- [[goal-inference-spec]]
- [[execution-pipeline-spec]]
