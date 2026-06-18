---
name: analise-de-taxa-de-resposta-de-outbound
description: Analisar as métricas de uma campanha de cold outbound — taxa de abertura, resposta, clique, bounce e unsubscribe — identificar o que está quebrando no funil e gerar recomendações de otimização específicas para subject line, corpo, CTA, timing e segmento.
tags: [analytics, métricas, taxa de resposta, outbound, campanha, otimização, funil, kpi]
---

# Análise de Taxa de Resposta de Outbound

## Objetivo
Analisar o desempenho de uma campanha de cold outbound end-to-end — identificando exatamente onde o funil está quebrando (abertura → clique → resposta → reunião) e gerando recomendações de otimização priorizadas. Usa dados do Analytics Agent do VRAXIA e do `outbound-log.json`.

## Quando usar
- Após enviar um batch de 50+ emails (dados suficientes para análise)
- Quando a taxa de resposta cai abaixo de 3% no cold email
- Para comparar performance entre campanhas por vertical ou cargo
- No review semanal/mensal do pipeline comercial

## Como usar
1. Passe os dados brutos da campanha (do Analytics Agent ou exportação)
2. O Comercial AI processa e identifica os gaps por etapa do funil
3. Recebe recomendações priorizadas por impacto estimado
4. Implemente as top 3 mudanças no próximo batch
5. Compare o A/B resultado na próxima análise

## O Prompt
```
Você é um analista de outbound B2B. Métricas sem diagnóstico são inúteis. Seu trabalho é interpretar os números, identificar a causa raiz de cada gap e recomendar ações específicas — não genéricas como "melhore o subject".

**DADOS DA CAMPANHA:**
- Nome da campanha: [nome]
- Período: [início — fim]
- Segmento: [vertical / cargo alvo]
- Total de emails enviados: [n]
- Enviados com sucesso (sem bounce): [n]

**MÉTRICAS:**
- Taxa de abertura: [%] (benchmark: >35% cold email, >50% follow-up)
- Taxa de clique (se houver link): [%] (benchmark: >3%)
- Taxa de resposta total: [%] (benchmark: >3% cold, >8% follow-up)
- Taxa de resposta positiva: [%] (benchmark: >1.5%)
- Taxa de bounce: [%] (alerta: >5%)
- Taxa de unsubscribe: [%] (alerta: >0.5%)
- Reuniões agendadas: [n] (benchmark: >0.5% dos enviados)

**SEQUÊNCIA USADA:**
D+0: [subject + primeiras palavras]
D+3: [subject + primeiras palavras]
D+7: [subject + primeiras palavras]

**DISTRIBUIÇÃO DAS RESPOSTAS:**
- Positivas (interesse, pediu mais): [n]
- Negativas (não tem fit, concorrente): [n]
- Neutras (fora do escritório, errou email): [n]
- Silêncio total: [n]

**DIAGNÓSTICO POR ETAPA DO FUNIL:**

Abertura → [ok/problema]
Causa provável: [subject, timing, domínio, nome remetente]
Ação: [específica]

Abertura → Resposta → [ok/problema]
Causa provável: [corpo, relevância, CTA, tamanho]
Ação: [específica]

Resposta → Reunião → [ok/problema]
Causa provável: [segmento, qualificação, timing da call]
Ação: [específica]

**TOP 3 OTIMIZAÇÕES PRIORIZADAS:**
1. [Ação] — impacto estimado: [+X% em qual métrica]
2. [Ação] — impacto estimado: [+X%]
3. [Ação] — impacto estimado: [+X%]

**SCORE DE SAÚDE DA CAMPANHA (1-10):**
[score] — [diagnóstico em 2 frases]
```

## Exemplo de uso

### Input
Campanha: Outbound Fintechs B2B — Junho/2026
Enviados: 80 | Abertura: 28% | Resposta: 2.1% | Reuniões: 1 | Bounce: 7%

### Output
**Diagnóstico:**
Abertura (28%) → abaixo do benchmark (35%). Causa: domínio novo + bounce 7% = reputação de IP comprometida. Prioridade: resolver entregabilidade antes de qualquer ajuste de copy.

Abertura → Resposta (2.1%) → limítrofe. O subject está gerando abertura razoável dado o deliverability baixo, mas o corpo não está convertendo. Prioridade 2: revisar os primeiros 2 parágrafos.

Reuniões (1/80 = 1.25%) → abaixo do target (0.5% = pelo menos 1, mas esperávamos 2-3). Foco em qualidade do segmento.

**Top 3 otimizações:**
1. Warm up do domínio vrashows.com.br — 2 semanas de warm up antes do próximo batch (+15% abertura estimada)
2. Revisar primeiros 2 parágrafos do email D+0 — testar lead com dado específico sobre fintech (+1.5% resposta)
3. Verificar lista — 7% bounce indica emails com padrão não confirmado (usar skill 003 antes do próximo batch)

**Score de saúde: 4/10** — problema de entregabilidade mascarando o real desempenho do copy. Resolver deliverability é pré-requisito para qualquer otimização de conteúdo.

---
**Tags:** Avançado | Analytics | Comercial, Métricas, Outbound, Otimização
