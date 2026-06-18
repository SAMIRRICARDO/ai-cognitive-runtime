---
name: pipeline-de-lead-sourcing-futurecom-researcher-agent
description: Usar o FuturecomResearcherAgent do VRAXIA para pesquisar automaticamente empresas exibidoras ou patrocinadoras de eventos B2B — via web search — e gerar a lista inicial de prospects ranqueados por score de fit, segmento e potencial de budget, pronta para enriquecimento.
tags: [lead sourcing, pesquisa, eventos, futurecom, researcher, web search, score, segmento, prospecção]
---

# Pipeline de Lead Sourcing (FuturecomResearcherAgent)

## Objetivo
Usar o `FuturecomResearcherAgent` do VRAXIA para pesquisar automaticamente empresas exibidoras, patrocinadoras ou participantes de eventos B2B — usando web search com prompts estruturados — e gerar a lista inicial de leads ranqueados por score de fit, complexidade de stand e potencial de budget. Saída em JSON pronto para o `LeadEnrichmentAgent`.

## Quando usar
- Antes de um evento B2B para montar a lista de prospects
- Para construir listas de empresas por segmento (telecom, cloud, fintech, etc.)
- Quando a lista manual é insuficiente ou está desatualizada
- Para encontrar empresas ainda não mapeadas no ICP

## Como usar
1. Execute o script de pipeline com o evento e segmentos alvo
2. O researcher usa web search para encontrar participantes do evento
3. Cada empresa recebe um `initialScore` (0-100) baseado em segmento e fit
4. A saída alimenta automaticamente o `LeadEnrichmentAgent` (próxima etapa)
5. Arquivos exportados em `data/leads/[evento]/`

## O Prompt
```
Você é o analista de inteligência de mercado do VRAXIA. Seu trabalho é mapear empresas com alta probabilidade de ser prospects ideais baseado no evento e segmento alvo.

**COMANDOS DO PIPELINE:**

Execução completa (research → enrich → validate):
```bash
tsx scripts/run-futurecom-pipeline.ts
```

Com parâmetros:
```bash
tsx scripts/run-futurecom-pipeline.ts \
  --min-score 60 \
  --max-leads 20 \
  --max-contacts 3 \
  --segments telecom,cloud,ai,fintech
```

**SEGMENTOS DISPONÍVEIS:**
- telecom, cloud, ai, cybersecurity, connectivity, infrastructure
- enterprise-software, iot, fintech

**FLAGS:**
- `--min-score N` — mínimo de score para incluir a empresa (padrão: 50)
- `--max-leads N` — máximo de empresas a pesquisar (padrão: 12, máximo: 25)
- `--max-contacts N` — máximo de contatos por empresa (padrão: 3)
- `--segments X,Y,Z` — segmentos a incluir
- `--json` — saída JSON em stdout (para pipelines)
- `--full-agent` — força uso do researcher completo (ignora CHEAP_MODE)

**SAÍDA DO RESEARCHER (LeadProfile por empresa):**
```json
{
  "company": "TechCorp",
  "website": "techcorp.com.br",
  "segment": "cloud",
  "eventRelevance": "Alto — patrocinador platinum confirmado",
  "budgetPotential": "enterprise",
  "boothComplexity": "large",
  "initialScore": 87,
  "strategicNotes": "Maior provedor de cloud no Brasil, historicamente investe em stand 360°",
  "sources": ["linkedin.com/company/techcorp", "techcorp.com.br/eventos"]
}
```

**SCORES DO RESEARCHER:**
- 85-100: Fit excelente — prioridade máxima de enriquecimento
- 70-84: Bom fit — enriquecer na mesma rodada
- 50-69: Fit moderado — incluir se slots disponíveis
- <50: Filtrado pelo `--min-score`

**ARQUIVOS GERADOS:**
- `data/leads/futurecom/futurecom_leads.json` — leads brutos do researcher
- `data/leads/futurecom/futurecom_leads.csv` — versão tabular para revisão
- `data/leads/futurecom/futurecom_validated_leads.json` — após enrich + validate
```

## Exemplo de uso

### Input
```bash
tsx scripts/run-futurecom-pipeline.ts --min-score 70 --max-leads 15 --segments telecom,cloud,fintech
```

### Output
```
VRASHOWS Futurecom Pipeline — research → enrich → validate

[research] Buscando empresas telecom exibidoras na Futurecom 2026...
[lead] Claro Brasil · score=95
[lead] TOTVS · score=88
[lead] AWS Brasil · score=85
[lead] Ericsson · score=83
[lead] Nokia · score=80
[lead] Huawei · score=78
[lead] Google Cloud · score=75

7 empresas encontradas (score ≥ 70)
Saved: data/leads/futurecom/futurecom_leads.json
```

---
**Tags:** Técnico | Automação | Comercial, Lead Sourcing, Pesquisa, Pipeline
