---
name: analise-de-cac-e-ltv
description: Calcular e interpretar o CAC (Custo de Aquisição de Cliente) e LTV (Lifetime Value) do pipeline comercial do VRAXIA — identificando quais segmentos e canais têm o melhor retorno — e gerar recomendações de onde concentrar investimento de prospecção para maximizar o LTV:CAC ratio.
tags: [cac, ltv, métricas, roi, segmento, canal, saas, retenção, rentabilidade, analytics]
---

# Análise de CAC e LTV

## Objetivo
Calcular o CAC e LTV do pipeline comercial do VRAXIA — identificando qual segmento, vertical ou canal de aquisição tem melhor relação LTV:CAC — e gerar recomendações de onde concentrar esforço de prospecção para maximizar o retorno por cliente. Base para decisões de alocação de budget comercial.

## Quando usar
- Revisão trimestral de performance comercial
- Antes de decidir onde investir no próximo ciclo de prospecção
- Para justificar a expansão de uma campanha (ROI demonstrado)
- Quando o custo de aquisição parece alto demais para o ticket médio

## Como usar
1. Levante os dados de custo e receita da planilha ou Analytics Agent
2. Passe para o Comercial AI junto com a segmentação desejada
3. Receba o dashboard de CAC/LTV por segmento e canal
4. Use as recomendações para priorizar o próximo ciclo

## O Prompt
```
Você é o analista financeiro de crescimento do VRAXIA. CAC e LTV são as métricas que determinam se o negócio é sustentável. Um LTV:CAC abaixo de 3x é sinal de alerta.

**DADOS DO PERÍODO:** [mês/trimestre/ano]

**MÉTRICAS BRUTAS:**

Investimento comercial total:
- Horas de SDR/closer (custo): R$ [valor]
- Ferramentas de outbound (email-sender, LinkedIn, Waalaxy): R$ [valor]
- Custo do pipeline VRAXIA (Anthropic API): R$ [valor]
- Outros custos comerciais: R$ [valor]
- TOTAL CAC POOL: R$ [soma]

Clientes novos no período: [N]
CAC médio = Total / N = R$ [resultado]

Receita por cliente:
- Ticket médio mensal: R$ [valor]
- Churn mensal estimado: [%]
- Vida média do cliente: [1/churn] meses

LTV = Ticket × (1/Churn) = R$ [resultado]

**CÁLCULOS POR SEGMENTO:**
[repita para cada segmento analisado]

Segmento: [ex: SaaS B2B 50-200 funcionários]
- Clientes no período: [N]
- CAC deste segmento: R$ [valor]
- LTV médio: R$ [valor]
- LTV:CAC ratio: [X]x
- Payback period: [meses]
- Status: ✅ Saudável (>3x) | ⚠️ Atenção (2-3x) | 🔴 Insustentável (<2x)

**ANÁLISE POR CANAL:**
| Canal | Leads gerados | Clientes | Conversão | CAC médio | LTV:CAC |
|---|---|---|---|---|---|
| Cold email | | | | | |
| LinkedIn DM | | | | | |
| Indicação | | | | | |
| Inbound | | | | | |

**RECOMENDAÇÕES:**
1. [Canal/segmento com melhor LTV:CAC] — escalar
2. [Canal/segmento com pior LTV:CAC] — reavaliar ou desativar
3. [Iniciativa para reduzir CAC] — [ação específica]
4. [Iniciativa para aumentar LTV] — [ação específica — ex: reduzir churn, upsell]

**PROJEÇÃO DE CRESCIMENTO:**
Com CAC=[atual] e LTV=[atual]:
- Para crescer MRR em R$[meta] → precisamos de [N] novos clientes → investimento: R$[N × CAC]
- Payback period: [meses] — aceitável/necessita melhorar
```

## Exemplo de uso

### Input
Período: Maio/2026 | CAC Pool: R$8.500 (3 clientes fechados) | Ticket médio: R$6.900/mês | Churn: 4%/mês

### Output
**CAC médio:** R$2.833
**LTV médio:** R$6.900 × (1/4%) = R$6.900 × 25 = R$172.500
**LTV:CAC ratio:** 60,9x — EXCELENTE ✅

**Por canal:**
| Canal | Clientes | CAC | LTV:CAC |
|---|---|---|---|
| LinkedIn DM | 2 | R$1.200 | 143x ✅ |
| Cold email | 1 | R$3.700 | 46x ✅ |
| Indicação | 0 | — | — |

**Recomendações:**
1. LinkedIn DM tem o menor CAC e melhor ratio — escalar de 10 para 20 leads/dia
2. Cold email tem payback de 0.5 meses — continuar com volume atual
3. Abrir canal de indicação (LTV:CAC potencial > 200x com CAC ≈ R$500)
4. Reduzir churn para 3% → LTV sobe 33%: R$230.000 (impacto maior que qualquer redução de CAC)

---
**Tags:** Avançado | Financeiro | Comercial, CAC, LTV, Métricas, ROI
