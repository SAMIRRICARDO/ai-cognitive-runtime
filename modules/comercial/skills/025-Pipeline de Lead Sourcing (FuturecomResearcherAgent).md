---
name: pipeline-de-lead-sourcing-futurecom-researcher-agent
description: Prospectar leads B2B enterprise usando prospect_leads (ferramenta unificada — busca web + enriquecimento + email real em uma chamada) ou o pipeline completo via scheduler diário (aquisição automática às 07:30 de segunda a sexta). Retorna nome, cargo, email, LinkedIn e contexto prontos para outreach.
tags: [lead sourcing, prospecção, prospect_leads, scheduler, aquisição, b2b, enterprise, futurecom, web search, email]
---

# Pipeline de Lead Sourcing (FuturecomResearcherAgent)

## Objetivo
Encontrar e enriquecer leads B2B enterprise com dados reais — usando `prospect_leads` no chat para leads imediatos, ou o scheduler automático para aquisição diária de até 25 leads por rodada.

## Opção 1 — prospect_leads (chat, imediato)

**Quando usar:** para buscar leads agora, durante o trabalho, de forma interativa.

**Como usar no chat:**
```
busque 1 lead de cloud enterprise em São Paulo
encontre decisores de marketing em eventos B2B telecom
prospecte 3 leads de cibersegurança enterprise brasil
```

**O agente executa automaticamente:**
1. Tavily busca decisores no segmento + localização
2. Haiku extrai contatos estruturados dos resultados
3. `deepEnrichContact()` faz busca web individual por pessoa:
   - Procura email real: `"Nome" "Empresa" email contato`
   - Confirma/encontra LinkedIn
   - Coleta contexto extra
4. Retorna lead completo com `email_source: "web" | "pattern"`

**Output:**
```json
{
  "found": 2,
  "leads": [
    {
      "name": "Ana Lima",
      "role": "Gerente de Eventos Corporativos",
      "company": "Claro Brasil",
      "email": "ana.lima@claro.com.br",
      "email_source": "web",
      "email_confidence": "high",
      "domain": "claro.com.br",
      "linkedin": "https://www.linkedin.com/in/ana-lima-claro",
      "extra_info": "Coordena eventos de grande porte para Claro Brasil...",
      "source": "https://linkedin.com/in/..."
    }
  ]
}
```

## Opção 2 — Scheduler diário (aquisição automática)

**Quando usar:** aquisição contínua de leads do pool Futurecom/enterprise sem intervenção manual.

**Configuração:**
- Tarefa Windows: `VRASHOWS Lead Acquisition`
- Executa: segunda a sexta às 07:30
- Máximo: 25 leads por rodada
- Deduplicação: automática contra histórico local + SQLite cache
- Rotação de pool: automática quando todas as empresas já foram processadas

**Execução manual:**
```bash
npm run leads:acquire
# com força (ignora guard de data):
npx tsx scheduler/lead-acquisition-scheduler.ts --force
```

**Parâmetros do pipeline completo:**
```bash
tsx scripts/run-futurecom-pipeline.ts \
  --min-score 70 \
  --max-leads 15 \
  --max-contacts 3 \
  --segments telecom,cloud,ai,fintech
```

**Segmentos disponíveis:**
- telecom, cloud, ai, cybersecurity, connectivity, infrastructure
- enterprise-software, iot, fintech

**Saída do scheduler:**
```json
{
  "status": "success",
  "leads": 23,
  "duplicatesRemoved": 13,
  "outputFile": "data/leads/futurecom/futurecom-expansion-2026-06-18.json"
}
```

## Rotação automática de pool

Quando todos os candidatos do pool já foram processados (leads=0), o scheduler:
1. Detecta esgotamento: `leads=0 && duplicatesRemoved >= pool.length`
2. Limpa cache SQLite de empresas adquiridas
3. Reseta `processedCompanyHashes` no state
4. Reinicia o ciclo — todos os candidatos ficam disponíveis novamente
5. Loga o evento como `pool_rotated`

**Governança (AGENTS.md):**
- `maxDailyRuns`: 1
- `maxOutputTokens`: 300
- `preferredModel`: claude-haiku-4-5-20251001
- `poolRotationDays`: 90

## Scores do pool enterprise

| Score | Classificação |
|---|---|
| 85-100 | Fit excelente — prioridade máxima |
| 70-84 | Bom fit — processar na mesma rodada |
| 50-69 | Fit moderado — incluir se slots disponíveis |
| < 50 | Filtrado automaticamente |

---
**Tags:** Técnico | Automação | Comercial, Lead Sourcing, Prospecção, Scheduler, prospect_leads
