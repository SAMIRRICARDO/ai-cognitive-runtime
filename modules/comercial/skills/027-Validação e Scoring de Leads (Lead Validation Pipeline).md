---
name: validacao-e-scoring-de-leads-lead-validation-pipeline
description: Validar e classificar os leads enriquecidos usando o scorer do VRAXIA — calculando o score final de cada contato com base em senioridade, cargo, email confidence e fit de área — e classificando em HOT, WARM, LOW_PRIORITY ou INVALID para priorizar o outbound.
tags: [validação, scoring, hot, warm, invalid, prioridade, email confidence, senioridade, pipeline, outbound]
---

# Validação e Scoring de Leads (Lead Validation Pipeline)

## Objetivo
Processar os leads enriquecidos pelo `LeadEnrichmentAgent` e calcular o score final de cada contato usando o `scorer.ts` do VRAXIA — classificando automaticamente em `HOT`, `WARM`, `LOW_PRIORITY` ou `INVALID` com base em senioridade do cargo, confiança do email, fit de área e prioridade estimada. Define a ordem exata de abordagem no outbound.

## Quando usar
- Após o enriquecimento (`LeadEnrichmentAgent`) gerar os contatos
- Para priorizar quem abordar primeiro quando há mais leads que capacidade
- Para filtrar leads inválidos antes de disparar emails e DMs
- Para gerar o relatório de saúde da lista antes de uma campanha

## Como usar
1. O `scoreLeads()` é chamado automaticamente no pipeline completo
2. Ou execute `tsx scripts/validate-leads.ts` para uma lista específica
3. A saída classifica cada contato e gera o arquivo `validated_leads.json`
4. Leads HOT vão imediatamente para o `outbound-log.json`
5. Leads INVALID ficam fora do pipeline — email inválido ou cargo fora do ICP

## O Prompt
```
Você é o validador de leads do VRAXIA. Um lead mal classificado desperdiça tempo e queima a reputação do domínio. Valide cada contato de forma rigorosa antes de autorizar o outbound.

**CRITÉRIOS DE CLASSIFICAÇÃO:**

**HOT (score ≥ 75):**
- Seniority: director ou c-level
- Email confidence: high (padrão conhecido no domínio)
- Área: match direto com ICP (events, marketing, brand)
- Cargo reconhecido como decisor de compra

**WARM (score 50-74):**
- Seniority: manager
- Email confidence: high ou medium
- Área: match indireto ou complementar

**LOW_PRIORITY (score 25-49):**
- Seniority: analyst ou cargo ambíguo
- Email confidence: low
- Área: não diretamente relacionada

**INVALID (score < 25 OU critério duro):**
- Email com confidence = "none" ou domínio genérico (gmail, hotmail)
- Cargo claramente fora do ICP (estágio, RH operacional, TI operacional)
- Empresa no blocklist

**CAMPOS DE ENTRADA (RawLead):**
```json
{
  "company": "Claro Brasil",
  "contactName": "Ana Lima",
  "role": "Gerente de Eventos Corporativos",
  "area": "events",
  "seniority": "manager",
  "linkedin": "linkedin.com/in/analima",
  "guessedEmails": [
    { "email": "ana.lima@claro.com.br", "confidence": 0.85 }
  ],
  "confidence": "high",
  "priority": "high",
  "priorityScore": 88
}
```

**SAÍDA DO SCORER (ValidatedLead):**
```json
{
  "contactName": "Ana Lima",
  "company": "Claro Brasil",
  "role": "Gerente de Eventos Corporativos",
  "email": "ana.lima@claro.com.br",
  "emailConfidence": 0.85,
  "linkedin": "linkedin.com/in/analima",
  "status": "HOT",
  "score": 82,
  "scoreBreakdown": {
    "seniority": 25,
    "emailConfidence": 20,
    "areaFit": 20,
    "priority": 17
  },
  "outreachStatus": "pending",
  "validatedAt": "2026-06-12T14:00:00Z"
}
```

**ARQUIVO DE SAÍDA:**
`data/leads/[evento]/futurecom_validated_leads.json`

**RESUMO DA VALIDAÇÃO:**
```json
{
  "totalLeads": 45,
  "hot": 12,
  "warm": 21,
  "lowPriority": 8,
  "invalid": 4,
  "validatedAt": "2026-06-12T14:00:00Z"
}
```

**EXECUÇÃO STANDALONE:**
```bash
tsx scripts/validate-leads.ts
```

**INTEGRAÇÃO COM OUTBOUND:**
```
HOT leads → outbound-log.json (prioridade 1)
WARM leads → outbound-log.json (prioridade 2)
LOW_PRIORITY → nurturing passivo
INVALID → blocklist ou descarte
```
```

## Exemplo de uso

### Input
45 leads enriquecidos da campanha Futurecom (mix de senioridades e empresas)

### Output
**Resumo:** HOT: 12 | WARM: 21 | LOW_PRIORITY: 8 | INVALID: 4

**HOT leads (amostra):**
1. Ana Lima / Claro — score 88 (director-level events, email confidence high)
2. Ricardo Santos / TOTVS — score 82 (VP Marketing, email high)
3. Julia Dias / Ericsson — score 78 (Head of Brand, email medium → high)

**INVALID leads:**
- Pedro Costa / Huawei — email: pedro.costa@gmail.com (domínio genérico)
- Maria Silva / Nokia — cargo: Estagiária de Marketing (fora da senioridade mínima)

---
**Tags:** Técnico | Qualidade | Comercial, Validação, Scoring, Pipeline
