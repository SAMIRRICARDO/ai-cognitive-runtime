---
name: gerador-de-icp-ideal-customer-profile
description: Definir o perfil do cliente ideal (ICP) com precisão — setor, porte, cargo decisor, dores prioritárias e sinais de compra — para calibrar toda a máquina de prospecção do VRAXIA e evitar desperdício de outbound com leads fora do perfil.
tags: [icp, prospecção, qualificação, segmentação, b2b, pipeline]
---

# Gerador de ICP (Ideal Customer Profile)

## Objetivo
Definir o perfil do cliente ideal (ICP) com precisão cirúrgica — setor, porte, cargo do decisor, dores prioritárias, sinais de compra e filtros de exclusão — para calibrar toda a máquina de prospecção do VRAXIA e evitar desperdício de outbound com leads fora do perfil.

## Quando usar
- Antes de montar qualquer lista de prospecção
- Quando a taxa de resposta do outbound está abaixo de 5%
- Ao entrar em um novo segmento ou vertical
- Para calibrar os filtros do agente de Lead Acquisition no VRAXIA
- Quando o ciclo de vendas está longo demais (prospect errado)

## Como usar
1. Copie o prompt no agente Comercial AI do VRAXIA
2. Responda com dados reais dos seus melhores clientes atuais
3. O agente entrega o ICP estruturado e os filtros para o pipeline
4. Configure os parâmetros no `lead-acquisition-scheduler.ts` ou passe para o Enricher Agent

## O Prompt
```
Você é um especialista em Revenue Operations com experiência em construir ICPs para empresas B2B que usam outbound automatizado. Um ICP ruim desperdiça 80% do orçamento de prospecção — um ICP preciso faz o pipeline trabalhar sozinho.

Vou te dar dados dos meus melhores clientes. Você vai extrair o padrão e montar o ICP completo.

**Produto/Solução:** [descreva o que você vende]
**Problema que resolve:** [dor principal]
**3 melhores clientes atuais (descreva cada um):**
- Cliente A: [setor, porte, cargo que assinou, dor que tinha, tempo de fechamento]
- Cliente B: [idem]
- Cliente C: [idem]

**Clientes que não deram certo (por quê não servem):**
- [descreva 1-2 casos negativos]

Entregue o ICP completo:

**1. FIRMOGRAFIA (filtros de empresa)**
- Setor(es) prioritário(s)
- Porte (faturamento ou número de funcionários)
- Estágio da empresa (startup, scale-up, enterprise)
- Localização geográfica
- Tecnologias que usam (tech stack)

**2. PSICOGRAFIA (contexto e momento)**
- Sinais de compra (o que indica que estão prontos: rodada de investimento, contratação de cargo X, notícia Y)
- Momento ideal (crescimento acelerado, novo produto, expansão)
- Dores prioritárias que fazem agir agora

**3. PERSONA DECISORA**
- Cargo do tomador de decisão
- Cargo do influenciador (que usa o produto)
- Cargo do bloqueador (quem pode travar)
- O que cada um prioriza

**4. FILTROS DE EXCLUSÃO (ICP negativo)**
- O que automaticamente descarta o lead

**5. LEAD SCORE — pontuação de fit**
- 3 sinais = lead quente (ação imediata no pipeline)
- 2 sinais = lead morno (nurturing)
- 1 sinal = fora do ICP (não prospectar)

**6. QUERY DE PROSPECÇÃO**
- Filtros prontos para LinkedIn Sales Navigator
- Keywords para busca no Google (site:linkedin.com)
- Critérios para o Enricher Agent do VRAXIA
```

## Exemplo de uso

### Input
Produto: VRAXIA OS — plataforma de agentes IA por departamento
3 melhores clientes: (A) Fintech 80 funcionários, CTO assinou, dor: time de ops sobrecarregado; (B) SaaS B2B 150 funcionários, VP de Produto, dor: documentação e processos manuais; (C) Consultoria 40 funcionários, CEO, dor: custo com analistas júnior

### Output
**Firmografia:** SaaS/Tech/Fintech, 30-300 funcionários, faturamento R$3M-R$50M, Brasil/LATAM
**Momento ideal:** Acabou de contratar Head de Produto ou VP de Ops, rodada seed/série A, crescimento >20% a.a.
**Decisor:** CTO, CEO ou VP de Produto/Operações
**Sinal quente:** Anúncio de expansão de time no LinkedIn + tech stack AWS/Azure + job posting para cargo operacional

---
**Tags:** Fundacional | Estratégia | Comercial, Pipeline, ICP
