---
name: gestao-de-pipeline-de-vendas
description: Revisar e priorizar o pipeline ativo — identificando quais oportunidades estão estagnadas, quais têm risco de perda, quais precisam de aceleração — e gerando o plano de ação semanal do Comercial AI para mover cada oportunidade para o próximo estágio.
tags: [pipeline, crm, gestão, priorização, forecast, oportunidades, revisão semanal, comercial]
---

# Gestão de Pipeline de Vendas

## Objetivo
Fazer a revisão semanal do pipeline ativo — identificando oportunidades estagnadas, em risco, e as que precisam de aceleração imediata — e gerando o plano de ação que o Orchestrator Agent executa para mover cada oportunidade para o próximo estágio. Replica a função de uma reunião de pipeline review, mas feita por IA.

## Quando usar
- Revisão semanal do pipeline (toda segunda-feira)
- Quando o fechamento do mês está em risco e precisa de foco
- Para priorizar os prospects que o closer deve ligar hoje
- Para gerar o forecast semanal/mensal

## Como usar
1. Exporte o estado atual do pipeline (do outbound-log ou CRM)
2. Passe para o Comercial AI junto com as metas do mês
3. Receba o plano de ação priorizado por urgência e valor
4. O Orchestrator Agent executa as ações automatizáveis
5. As ações humanas são enviadas como lista de tarefas

## O Prompt
```
Você é o gestor de pipeline de um time de vendas B2B. Sua função é olhar para o estado atual do pipeline e tomar decisões sobre o que priorizar — baseado em probabilidade de fechamento, valor da oportunidade e urgência.

**META DO MÊS:** R$ [valor] (faltam [n] dias)
**RECEITA FECHADA ATÉ AGORA:** R$ [valor] ([%] da meta)
**GAP:** R$ [valor restante para bater a meta]

**PIPELINE ATUAL:**
[Liste as oportunidades com os campos abaixo ou cole o JSON do outbound-log]

Para cada oportunidade:
- Prospect: [nome + empresa]
- Estágio: [proposta enviada / demo feita / negociação / etc]
- Valor estimado: R$[valor]
- Último contato: [data e o que foi discutido]
- Próximo passo prometido: [o que foi combinado]
- Data do próximo passo: [quando]
- Dias parado no estágio: [n dias]

**ANÁLISE DO PIPELINE:**

**🔴 URGENTE — Mover esta semana (ou perder):**
[lista de oportunidades + ação específica + prazo]

**🟡 ATENÇÃO — Estagnadas (mais de 14 dias sem movimento):**
[lista + diagnóstico de por que estagnaram + ação de desbloqueio]

**🟢 NO TRILHO — Saudáveis, manter cadência:**
[lista + próximo passo já definido]

**⚫ DESCARTE — Remover do pipeline ativo:**
[leads que não vão fechar, ocupam espaço mental e distorcem o forecast]

**FORECAST DO MÊS:**
- Comprometido (>80% de fechar): R$
- Provável (50-80%): R$
- Possível (<50%): R$
- Total ponderado: R$
- Gap projetado até a meta: R$

**PLANO DE AÇÃO SEMANAL (5 ações prioritárias):**
1. [Ação] — Responsável: [humano/agente] — Prazo: [data]
2. [Ação] — [...]
3. [Ação]
4. [Ação]
5. [Ação]
```

## Exemplo de uso

### Input
Meta: R$50.000 | Fechado: R$12.000 (24%) | Faltam 18 dias
Pipeline: 8 oportunidades, variando de "proposta enviada" a "negociação"

### Output
**Urgente:**
1. DataLayer (Ricardo, CTO) — Proposta enviada há 11 dias, sumiu após "vou analisar". Ação: ligar agora, não email. Prazo: hoje.
2. SalesFlow (Marina) — Negociação parou por questão de contrato. Ação: enviar minuta simplificada, remover barreira jurídica. Prazo: amanhã.

**Estagnadas:**
- FinPay — 19 dias no estágio "demo feita". Sem próximo passo definido. Ação: email de reativação (skill 014) com novo ângulo.

**Descarte:**
- LogiBR — CFO disse "talvez Q1 do próximo ano". Mover para nurturing passivo, liberar do pipeline ativo.

**Forecast:** Comprometido R$18k | Provável R$14k | Total ponderado R$32k | Gap projetado: R$18k abaixo da meta.

**Plano semanal:** 1) Ligar para Ricardo hoje 2) Minuta para SalesFlow 3) Reativação FinPay 4) Qualificar 3 novos leads da fila 5) Proposta para Contabilex (demo foi boa)

---
**Tags:** Avançado | Gestão | Comercial, Pipeline, Forecast, Priorização
