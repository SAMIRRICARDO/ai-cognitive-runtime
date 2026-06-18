---
name: diagnostico-de-fit-com-icp-pos-call
description: Analisar as notas de uma call de discovery para calcular o fit real do prospect com o ICP — identificando alinhamento e gaps em cada dimensão (setor, porte, cargo, dor, momento, budget, timeline) e decidindo automaticamente o próximo passo no pipeline.
tags: [icp, fit, qualificação, pipeline, diagnóstico, sql, pos-call, decisão]
---

# Diagnóstico de Fit com ICP Pós-Call

## Objetivo
Processar as notas de uma call de discovery e calcular o fit real do prospect com o ICP configurado — identificando alinhamento em cada dimensão e gerando uma decisão automática: SQL (avançar para proposta), MQL (nutrir), ou descarte. Elimina subjetividade do processo de qualificação.

## Quando usar
- Imediatamente após uma call de discovery ou reunião inicial
- Para calibrar o ICP quando muitos leads qualificados não fecham
- Para auditar leads que entraram no pipeline sem qualificação formal
- Para criar consistência na qualificação entre múltiplos SDRs

## Como usar
1. Cole as notas brutas da call no prompt
2. O Comercial AI analisa contra o ICP configurado
3. Recebe o scorecard com diagnóstico por dimensão
4. O Orchestrator Agent executa o próximo passo automaticamente
5. Resultado armazenado no `outbound-log.json` para histórico

## O Prompt
```
Você é um analista de qualificação de vendas B2B. Seu trabalho é eliminar o viés emocional do processo de qualificação — prospects simpáticos ou que demonstram entusiasmo não significam fit real. Analise as notas da call de forma fria e objetiva.

**ICP CONFIGURADO:**
- Setor ideal: [ex: SaaS B2B, Fintech, Indústria]
- Porte: [ex: 30-300 funcionários]
- Cargo do decisor: [ex: CTO, CEO, Head of Ops]
- Dor primária que o produto resolve: [descreva]
- Sinais de momento ideal: [ex: série recente, contratações, expansão]
- Budget esperado: [faixa de investimento]
- Timeline ideal: [ex: decisão em 60-90 dias]

**NOTAS DA CALL:**
[cole aqui tudo que foi discutido — respostas, objeções, contexto, próximos passos prometidos]

**DIAGNÓSTICO POR DIMENSÃO (score 0-5 em cada):**

| Dimensão | Score | Evidência da Call | Status |
|---|---|---|---|
| Setor / Vertical | /5 | | ✅/⚠️/❌ |
| Porte da empresa | /5 | | ✅/⚠️/❌ |
| Cargo do decisor | /5 | | ✅/⚠️/❌ |
| Dor real e urgente | /5 | | ✅/⚠️/❌ |
| Momento favorável | /5 | | ✅/⚠️/❌ |
| Budget viável | /5 | | ✅/⚠️/❌ |
| Timeline em 90 dias | /5 | | ✅/⚠️/❌ |

**SCORE TOTAL: [0-35]**

**CLASSIFICAÇÃO:**
- 28-35: SQL Premium — proposta em 48h, prioridade máxima
- 21-27: SQL — proposta na semana, prioridade normal
- 14-20: MQL — nurturing ativo, check-in em 30 dias
- <14: Descarte — lista de nurturing passivo

**RED FLAGS DETECTADOS:**
[liste qualquer sinal de alerta — decisor errado, budget impossível, competitor instalado]

**GREEN FLAGS:**
[sinais que aumentam a confiança no fechamento]

**PRÓXIMO PASSO RECOMENDADO:**
Ação: [o que fazer]
Responsável: [Orchestrator Agent / humano]
Prazo: [quando]
Mensagem de follow-up: [rascunho do que enviar]
```

## Exemplo de uso

### Input
ICP: SaaS B2B | 50-200 funcionários | CTO/CEO | Dor: automação de processos | Budget: R$3k-R$20k/mês
Notas: "Maria (CTO) muito entusiasmada, disse que o problema de automação é real, mas o CEO precisa aprovar. Orçamento ainda não definido para Q3. Série A há 8 meses, 80 funcionários."

### Output
| Dimensão | Score | Evidência | Status |
|---|---|---|---|
| Setor | 5/5 | SaaS B2B confirmado | ✅ |
| Porte | 5/5 | 80 funcionários | ✅ |
| Cargo do decisor | 3/5 | CTO é influenciadora — CEO decide | ⚠️ |
| Dor real | 4/5 | Confirmada, "é real" | ✅ |
| Momento | 4/5 | Série A 8 meses, estabilizando | ✅ |
| Budget | 2/5 | "Ainda não definido para Q3" | ⚠️ |
| Timeline | 3/5 | Q3 sugere 60-90 dias | ⚠️ |

**Score: 26/35 — SQL (proposta na semana)**

**Red flags:** Decisor real é o CEO — incluir na próxima call. Budget ainda não formalizado.

**Próximo passo:** Enviar proposta para Maria + solicitar meeting trilateral com CEO em 7 dias.

---
**Tags:** Intermediário | Framework | Comercial, Qualificação, ICP, Pipeline
