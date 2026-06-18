---
name: pipeline-completo-de-prospeccao-linkedin-fim-a-fim
description: Visão geral e guia operacional do pipeline completo de prospecção LinkedIn do VRAXIA — desde sourcing de leads por evento até a notificação do closer — conectando FuturecomResearcherAgent, LeadEnrichmentAgent, EmailPatternResolver, lead-validation, linkedin_dm_dispatcher, LeadStateMachine, LeadClassifierAgent e webhookServer em um fluxo orquestrado.
tags: [pipeline, linkedin, end-to-end, orchestrator, sourcing, enrichment, dispatcher, classifier, webhook, handoff]
---

# Pipeline Completo de Prospecção LinkedIn Fim-a-Fim

## Objetivo
Documentar o fluxo completo de prospecção LinkedIn do VRAXIA — do zero até o handoff para o closer humano — conectando todos os agentes e scripts em sequência lógica. Usado como referência operacional para lançar, monitorar e depurar campanhas de outbound LinkedIn baseadas em eventos B2B.

## Quando usar
- Para lançar uma campanha do zero (ex: novo evento como Futurecom)
- Como referência de troubleshooting quando algo quebra no pipeline
- Para onboarding de um operador novo no VRAXIA
- Para planejar o cronograma operacional de uma campanha

## Como usar
Siga as etapas em ordem. Cada etapa tem seu script e validação própria.

## O Prompt
```
Você é o operador principal do pipeline de prospecção LinkedIn do VRAXIA. Este é o manual completo.

**ARQUITETURA DO PIPELINE:**

```
[EVENTO] Futurecom / Feira / Congresso
        ↓
[ETAPA 1] Lead Sourcing
  FuturecomResearcherAgent
  Script: tsx scripts/run-futurecom-pipeline.ts --max-leads 20 --segments telecom,cloud
  Saída:  data/leads/futurecom/futurecom_leads.json (LeadProfile[])
        ↓
[ETAPA 2] Lead Enrichment
  LeadEnrichmentAgent + EmailPatternResolver
  Script: (automático no pipeline) ou tsx scripts/run-enrichment.ts
  Saída:  data/leads/futurecom/futurecom_validated_leads.json (EnrichedContact[])
        ↓
[ETAPA 3] Validação e Scoring
  lead-validation/scorer.ts
  Script: (automático no pipeline) ou tsx scripts/validate-leads.ts
  Saída:  ValidatedLead[] com status HOT/WARM/LOW_PRIORITY/INVALID
        ↓
[ETAPA 4] Preparação da Lista LinkedIn
  Manual ou script: exportar HOT+WARM para JSON com formato:
  { "contacts": [{ "name", "company", "role", "linkedin_url" }] }
  Caminho: data/leads/futurecom/futurecom-event-decision-makers-linkedin-YYYY-MM-DD.json
        ↓
[ETAPA 5] Disparo LinkedIn
  linkedin_dm_dispatcher.ts + LeadStateMachine
  Script: tsx scripts/linkedin_dm_dispatcher.ts --limit=10
  Dry-run: tsx scripts/linkedin_dm_dispatcher.ts --dry-run
  Daily cap: 10 ações/dia | Janela: seg-sex 8h-18h BRT
  Saída:  vault/imprensa/logs/linkedin_dm_YYYY-MM-DD.json
          data/linkedin/lead-states.json (SM persistente)
        ↓
[ETAPA 6] Monitoramento de Respostas
  webhookServer.ts (Fastify) + Waalaxy webhook
  Script: tsx workers/webhookServer.ts (porta 3001)
  Input:  POST /webhook/waalaxy (da Waalaxy)
        ↓
[ETAPA 7] Classificação Automática
  LeadClassifierAgent (Haiku)
  Classifica: variant (A-E), intent, decision_power, handoff
        ↓
[ETAPA 8] Handoff / Notificação
  notifyManager → Telegram/Slack/Email
  handoff=true: closer recebe alerta instantâneo
  handoff=false: log registrado, sem escalada
```

**CRONOGRAMA OPERACIONAL (campanha de 10 dias):**

| Dia | Ação | Script |
|---|---|---|
| D-3 | Research de leads do evento | run-futurecom-pipeline.ts |
| D-2 | Validar e preparar lista JSON para LinkedIn | (manual) |
| D-1 | Dry-run do dispatcher | --dry-run |
| D+0 | Batch 1: 10 leads | --limit=10 |
| D+1 | Verificar SM states | lead-states.json |
| D+2 | Batch 2: 10 leads | --offset=10 --limit=10 |
| D+3 | Iniciar webhookServer para Waalaxy | webhookServer.ts |
| D+4 | Batch 3: 10 leads | --offset=20 --limit=10 |
| D+7 | Revisar respostas + classified leads | lead-states.json |
| D+10 | Análise de campanha + reativação warm leads | Analytics Agent |

**VARIÁVEIS DE AMBIENTE NECESSÁRIAS:**
```env
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=...
NOTIFY_CHANNEL=telegram
RESEND_API_KEY=re_...
DEV_MODE=false
```

**COMANDOS RÁPIDOS DE OPERAÇÃO:**
```bash
# Pipeline completo (research + enrich + validate)
tsx scripts/run-futurecom-pipeline.ts --min-score 70 --max-leads 20

# Dispatcher (dry-run primeiro, depois produção)
tsx scripts/linkedin_dm_dispatcher.ts --dry-run
tsx scripts/linkedin_dm_dispatcher.ts --limit=10

# Webhooks para respostas
tsx workers/webhookServer.ts

# Classificar resposta manual
tsx scripts/classifyReply.ts
```

**MÉTRICAS DE SAÚDE DO PIPELINE:**
| Métrica | Target | Alerta |
|---|---|---|
| Taxa de entrega DM | >85% | <70% |
| InMail bloqueado | <20% | >35% |
| Taxa de resposta LinkedIn | >5% | <2% |
| Intent high (das respostas) | >20% | <10% |
| Handoffs convertidos | >30% | <15% |
```

## Exemplo de uso

### Input
Campanha: Futurecom 2026 | Segmentos: telecom, cloud | Target: 50 leads, 5 dias de disparo

### Output
**Resultados após 5 dias:**
- Research: 20 empresas (score ≥ 70)
- Enrichment: 45 contatos (2.25/empresa média)
- Validation: 18 HOT | 21 WARM | 6 LOW | 0 INVALID (39 para LinkedIn)
- Dispatcher: 30 enviados (5 dias × 10/dia) | 5 InMail bloqueado | 25 entregues
- SM States: 12 MESSAGE_SENT | 8 INVITATION_SENT | 5 CLOSED
- Respostas recebidas: 4 (taxa: 13.3%)
- Handoffs: 2 (Ricardo/TOTVS + Ana/Claro) — intent=high, decision_power=high

---
**Tags:** Avançado | Operacional | Comercial, Pipeline, LinkedIn, Orquestração, End-to-End
