---
title: VRAXIA Sense - Lead Intelligence 360°
type: intelligence-spec
module: lead-intelligence
status: implementation-ready
version: 1.0
created: 2026-06-18
tags: [vraxia, sense, lead, inteligencia, 360, enriquecimento]
depends_on: [commercial-sense-spec, execution-pipeline-spec]
metodologia: VRAXIA Sense™
ciclo: PERCEBER → COMPREENDER → DECIDIR → AGIR → EVOLUIR
---

# VRAXIA Sense™ — Lead Intelligence 360°

> O Sense nunca retorna apenas um nome e um cargo.
> Ele percebe, compreende e entrega inteligência completa
> sobre o lead para maximizar a probabilidade de fechamento.
> O propósito do Sense é sempre ir além.

## 1. Filosofia de Inteligência de Lead

A maioria dos sistemas de prospecção retorna dados.
O VRAXIA Sense™ retorna **inteligência**.

```
DADO:          "Rodrigo Shimizu, Diretor de Marketing, Oi"
INTELIGÊNCIA:  Rodrigo está há 8 meses no cargo (janela de mudança),
               a Oi participou de 3 feiras em 2025 (padrão confirmado),
               ele postou sobre ROI de eventos semana passada (sinal quente),
               orçamento de marketing cresceu 12% (momento favorável),
               ele tem conexão com um cliente atual da VRASHOWS (porta de entrada).
```

## 2. Cinco Pilares do VRAXIA Sense™ aplicados ao Lead

```
PERCEBER    → captar todos os sinais disponíveis sobre o lead e sua empresa
COMPREENDER → interpretar o contexto, momento e motivação do decisor
DECIDIR     → calcular fit, score e probabilidade de fechamento
AGIR        → gerar abordagem personalizada por canal
EVOLUIR     → aprender com cada interação para melhorar os próximos
```

## 3. Dimensões de Inteligência — Mapa Completo

### 3.1 Dimensão Comportamental
O que o lead faz, diz e sinaliza publicamente.

```typescript
behavioral: {
  linkedin_activity: {
    recent_posts: string[],          // últimos posts publicados
    post_topics: string[],           // temas recorrentes
    engagement_level: 'high'|'medium'|'low',
    last_post_date: string,
    mentions_events: boolean,        // falou sobre eventos recentemente?
    mentions_pain_points: string[]   // dores mencionadas publicamente
  },
  content_interactions: {
    follows_competitors: boolean,
    engages_with_event_content: boolean,
    shares_industry_news: boolean
  },
  career_signals: {
    time_in_current_role_months: number,
    // < 6 meses: ainda aprendendo, difícil de vender
    // 6-18 meses: janela ideal — quer mostrar resultado
    // > 24 meses: confortável, precisa de dor clara para mover
    recent_promotion: boolean,       // promoção recente = quer mostrar resultado
    open_to_new_connections: boolean,
    profile_updated_recently: boolean // perfil atualizado = momento de mudança
  }
}
```

### 3.2 Dimensão Estratégica
O que a empresa do lead está fazendo e para onde vai.

```typescript
strategic: {
  company_events_history: {
    events_participated_last_12m: number,
    fairs_attended: string[],
    stand_sizes: string[],           // tamanho do stand indica orçamento
    events_planned_next_6m: string[] // eventos futuros confirmados
  },
  company_growth_signals: {
    hiring_in_marketing_events: boolean, // está contratando na área?
    new_office_or_expansion: boolean,
    recent_funding_or_investment: boolean,
    entering_new_market: boolean
  },
  competitive_positioning: {
    main_competitors: string[],
    differentiates_via_events: boolean, // evento é estratégia de marca?
    brand_presence_level: 'high'|'medium'|'low'
  },
  decision_context: {
    budget_cycle: 'Q1'|'Q2'|'Q3'|'Q4'|'unknown',
    // Quando a empresa define orçamento — momento ideal para abordar
    vendor_review_period: boolean,   // está revisando fornecedores?
    current_event_vendor: string|null // já tem parceiro de eventos?
  }
}
```

### 3.3 Dimensão Financeira
Capacidade e momento de investimento.

```typescript
financial: {
  company_revenue_tier: 'startup'|'smb'|'mid_market'|'enterprise',
  estimated_event_budget: {
    annual_usd: number|null,
    per_event_usd: number|null,
    confidence: 'high'|'medium'|'low'
  },
  financial_health_signals: {
    recent_layoffs: boolean,         // sinal negativo para venda
    cost_cutting_news: boolean,      // sinal negativo
    investment_in_marketing: boolean,// sinal positivo
    ipo_or_acquisition_news: boolean // sinal de mudança de prioridade
  },
  pricing_sensitivity: 'price_driven'|'value_driven'|'unknown'
}
```

### 3.4 Dimensão Social
Relacionamentos e rede de influência.

```typescript
social: {
  network_overlap: {
    mutual_connections: number,
    mutual_connections_names: string[],
    connected_to_vrashows_clients: boolean, // porta de entrada valiosa
    connected_to_vrashows_team: boolean
  },
  influence_level: {
    followers_count: number,
    industry_speaker: boolean,       // palestrante = alta visibilidade
    association_member: boolean,     // membro de ABEOC, ABIH, etc
    awards_or_recognition: boolean
  },
  social_proof_levers: {
    // O que pode ser usado para criar credibilidade na abordagem
    knows_someone_who_used_vrashows: boolean,
    attended_event_vrashows_operated: boolean,
    follows_vrashows_linkedin: boolean
  }
}
```

### 3.5 Dimensão Operacional
Como a empresa opera hoje e onde a VRASHOWS encaixa.

```typescript
operational: {
  current_event_operation: {
    model: 'internal'|'agency'|'mixed'|'unknown',
    pain_points_known: string[],     // dores operacionais identificadas
    number_of_vendors_typically: number|null,
    satisfaction_with_current: 'high'|'medium'|'low'|'unknown'
  },
  event_complexity: {
    typical_attendees: number|null,
    international_events: boolean,
    multi_city_events: boolean,
    custom_activations: boolean      // ativações customizadas = ticket alto
  },
  vrashows_fit: {
    services_needed: string[],       // quais serviços da VRASHOWS fazem fit
    // ['stand', 'transfer', 'recepcionistas', 'logistica', 'foto_video', 'seguranca']
    estimated_ticket: 'low'|'medium'|'high'|'enterprise',
    urgency: 'immediate'|'next_quarter'|'next_year'|'unknown'
  }
}
```

## 4. Lead Intelligence Score — Cálculo Composto

O score final não é só sobre o lead. É sobre o **momento + fit + acesso**.

```typescript
interface LeadIntelligenceScore {
  // Score base (0-100)
  icp_fit_score: number,           // peso 30% — fit com ICP da VRASHOWS
  behavioral_score: number,        // peso 25% — sinais de engajamento e momento
  strategic_score: number,         // peso 20% — momento estratégico da empresa
  financial_score: number,         // peso 15% — capacidade e momento financeiro
  social_score: number,            // peso 10% — facilidade de acesso e influência

  // Score final ponderado
  composite_score: number,         // 0-100

  // Classificação
  tier: 'A'|'B'|'C'|'D',
  // A (80-100): abordar hoje, pipeline prioritário
  // B (60-79):  abordar essa semana
  // C (40-59):  nurture — aquecer antes de abordar
  // D (0-39):   descartar ou arquivar

  // Timing
  best_time_to_contact: string,    // ex: "próximas 2 semanas"
  urgency_reason: string,          // ex: "evento em 45 dias"

  // Probabilidade estimada
  win_probability: number,         // 0-100%
  estimated_deal_size: string      // ex: "R$15.000 - R$35.000"
}
```

## 5. Prompt de Lead Intelligence 360°

Modelo: Haiku (dimensões 1-4) + Sonnet (apenas síntese final e score)
Estratégia: dividir em chamadas menores para economizar tokens

```typescript
// prompts/commercial/leadIntelligencePrompt.ts

export const BEHAVIORAL_ANALYSIS_PROMPT = `
Analise o perfil do lead e retorne JSON puro:
{
  "recent_topics": [],
  "mentions_events": true|false,
  "pain_points": [],
  "time_in_role_months": 0,
  "career_signal": "early"|"golden_window"|"comfortable",
  "engagement_level": "high"|"medium"|"low"
}
golden_window = 6 a 18 meses no cargo.
Max 100 tokens output.
`.trim();

export const STRATEGIC_ANALYSIS_PROMPT = `
Analise o contexto estratégico da empresa do lead. JSON puro:
{
  "events_per_year_estimate": 0,
  "growth_signals": [],
  "budget_cycle_estimate": "Q1"|"Q2"|"Q3"|"Q4"|"unknown",
  "vendor_model": "internal"|"agency"|"mixed"|"unknown",
  "strategic_fit": "high"|"medium"|"low"
}
Max 100 tokens output.
`.trim();

export const INTELLIGENCE_SYNTHESIS_PROMPT = `
Você é o motor de inteligência do VRAXIA Sense™.
Sintetize todas as dimensões do lead em inteligência acionável.
Retorne JSON puro:
{
  "composite_score": 0-100,
  "tier": "A"|"B"|"C"|"D",
  "win_probability": 0-100,
  "estimated_deal_size": "string",
  "urgency_reason": "string",
  "best_approach": "linkedin"|"whatsapp"|"email"|"cold_call",
  "opening_hook": "frase de abertura personalizada em 1 linha",
  "key_pain_to_address": "string",
  "social_proof_to_use": "string|null",
  "red_flags": [],
  "green_flags": [],
  "recommended_action": "string"
}
Max 300 tokens output.
`.trim();
```

## 6. Agente de Lead Intelligence 360°

```typescript
// agents/commercial/leadIntelligence.ts
// Orquestra todas as dimensões de análise do lead.
// Substitui o enrichment.ts simples por inteligência completa.

import Anthropic from '@anthropic-ai/sdk';
import {
  BEHAVIORAL_ANALYSIS_PROMPT,
  STRATEGIC_ANALYSIS_PROMPT,
  INTELLIGENCE_SYNTHESIS_PROMPT
} from '../../prompts/commercial/leadIntelligencePrompt';
import type { Lead, AgentOutput } from '../../types/commercial';

const client = new Anthropic();

export interface LeadIntelligence {
  lead: Lead;
  behavioral: Record<string, unknown>;
  strategic: Record<string, unknown>;
  composite_score: number;
  tier: 'A' | 'B' | 'C' | 'D';
  win_probability: number;
  estimated_deal_size: string;
  opening_hook: string;
  key_pain_to_address: string;
  social_proof_to_use: string | null;
  red_flags: string[];
  green_flags: string[];
  recommended_action: string;
  best_approach: string;
}

export async function runLeadIntelligence360(
  lead: Lead
): Promise<AgentOutput> {

  const leadContext = JSON.stringify(lead);

  // CHAMADA 1 — Análise comportamental (Haiku, 100 tokens)
  const behavioralRes = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    system: BEHAVIORAL_ANALYSIS_PROMPT,
    messages: [{ role: 'user', content: leadContext }]
  });

  // CHAMADA 2 — Análise estratégica (Haiku, 100 tokens)
  const strategicRes = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    system: STRATEGIC_ANALYSIS_PROMPT,
    messages: [{ role: 'user', content: leadContext }]
  });

  const behavioral = safeJsonParse(behavioralRes);
  const strategic = safeJsonParse(strategicRes);

  // CHAMADA 3 — Síntese final (Sonnet, 300 tokens — qualidade crítica)
  const synthesisContext = JSON.stringify({ lead, behavioral, strategic });

  const synthesisRes = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: INTELLIGENCE_SYNTHESIS_PROMPT,
    messages: [{ role: 'user', content: synthesisContext }]
  });

  const synthesis = safeJsonParse(synthesisRes);

  const intelligence: LeadIntelligence = {
    lead,
    behavioral,
    strategic,
    ...synthesis
  };

  return {
    success: true,
    data: { intelligence, lead: { ...lead, score: synthesis.composite_score } },
    next_action: synthesis.tier === 'D' ? 'discard_lead' : 'generate_outreach'
  };
}

function safeJsonParse(response: Anthropic.Message): Record<string, unknown> {
  const raw = response.content[0].type === 'text'
    ? response.content[0].text.trim() : '{}';
  try { return JSON.parse(raw); } catch { return {}; }
}
```

## 7. Output Final Expandido

O que o usuário recebe com Lead Intelligence 360°:

```json
{
  "lead": {
    "name": "Rodrigo Shimizu",
    "company": "Oi",
    "role": "Diretor de Marketing",
    "linkedin_url": "..."
  },
  "intelligence": {
    "composite_score": 87,
    "tier": "A",
    "win_probability": 73,
    "estimated_deal_size": "R$25.000 - R$45.000",
    "opening_hook": "Vi que a Oi participou do Futurecom — e que você postou sobre ROI de presença em feiras.",
    "key_pain_to_address": "Coordenar múltiplos fornecedores no dia do evento consome o time que deveria estar em reunião.",
    "social_proof_to_use": "A Ambev usou a VRASHOWS no mesmo evento e reduziu 40% da carga operacional.",
    "green_flags": [
      "8 meses no cargo — janela ideal para mostrar resultado",
      "Empresa crescendo e participando de mais feiras",
      "Postou sobre eventos recentemente — tema quente para ele"
    ],
    "red_flags": [
      "Pode já ter parceiro de eventos consolidado"
    ],
    "best_approach": "linkedin",
    "recommended_action": "Abordar via LinkedIn hoje com hook sobre ROI de eventos. Urgência: evento em 45 dias."
  },
  "behavioral": { ... },
  "strategic": { ... },
  "outreach": {
    "linkedin_message": "...",
    "whatsapp_message": "...",
    "email_subject": "...",
    "email_body": "...",
    "cold_call_script": "..."
  },
  "opportunity": {
    "id": "opp_...",
    "tier": "A",
    "next_action": "linkedin_contact",
    "next_action_date": "2026-06-19"
  },
  "pipeline_complete": true
}
```

## 8. Custo por Lead Intelligence 360°

| Chamada | Modelo | Tokens Output | Custo Est. |
|---|---|---|---|
| Behavioral Analysis | Haiku | 100 | $0.0001 |
| Strategic Analysis | Haiku | 100 | $0.0001 |
| Intelligence Synthesis | Sonnet | 300 | $0.0015 |
| Outreach Generation | Sonnet | 800 | $0.0040 |
| **Total por lead** | | | **~$0.006** |

6 décimos de centavo de dólar por lead com inteligência completa em 5 dimensões.

## 9. Atualização necessária no execution-pipeline-spec

Substituir `enrichment.ts` por `leadIntelligence.ts` no pipeline:

```
ANTES: search_lead → enrich_lead → score_lead → generate_outreach → crm
AGORA: search_lead → lead_intelligence_360 → generate_outreach → crm
```

O `lead_intelligence_360` absorve enriquecimento + scoring em uma
sequência de 3 chamadas otimizadas, retornando tudo de uma vez.

## 10. Ver também

- [[commercial-sense-spec]]
- [[goal-inference-spec]]
- [[execution-pipeline-spec]]
- [[vraxia-sense-architecture]]
