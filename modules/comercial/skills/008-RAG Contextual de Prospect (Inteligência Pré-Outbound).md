---
name: rag-contextual-de-prospect-inteligencia-pre-outbound
description: Usar o RAG Agent do VRAXIA para coletar e sintetizar inteligência sobre o prospect antes do outbound — posts LinkedIn, notícias da empresa, job postings, tech stack e sinais de compra — gerando o contexto que personaliza o hook do cold email e da DM.
tags: [rag, contexto, inteligência, prospect, personalização, hook, linkedin, sinais de compra]
---

# RAG Contextual de Prospect (Inteligência Pré-Outbound)

## Objetivo
Coletar e sintetizar inteligência sobre o prospect antes do primeiro contato — usando o RAG Agent do VRAXIA para buscar posts LinkedIn, notícias da empresa, vagas abertas, tech stack e sinais de compra — gerando o contexto que personaliza o hook do email e torna a abordagem 10x mais relevante.

## Quando usar
- Antes de gerar o email de prospecção (skill 004) ou a DM (skills 006, 007)
- Para identificar o momento certo de abordar (timing = fator crítico)
- Quando o Enricher Agent retorna um lead sem contexto suficiente
- Para calibrar o ângulo da proposta antes do primeiro toque

## Como usar
1. O Enricher Agent passa os dados básicos do prospect (nome, empresa, LinkedIn)
2. O RAG Agent do VRAXIA busca nas fontes configuradas (web, LinkedIn, news)
3. Este prompt sintetiza o contexto extraído em formato padrão
4. O contexto alimenta o gerador de email (skill 004) e de DM (skill 006)
5. Armazenado no pgvector para evitar buscas repetidas do mesmo prospect

## O Prompt
```
Você é um analista de inteligência comercial. Seu trabalho é encontrar os sinais que tornam um cold email personalizado — não genérico. Um prospect que recebeu um email que parece escrito especificamente para ele responde 3-5x mais.

Analise o prospect e sintetize a inteligência para o outbound:

**DADOS DO PROSPECT:**
- Nome completo: [nome]
- Cargo: [cargo]
- Empresa: [empresa]
- LinkedIn: [URL]
- Setor: [setor]

**FONTES PESQUISADAS (pelo RAG Agent):**
[cole aqui o resultado bruto das buscas — posts, notícias, vagas, site]

Sintetize em formato estruturado:

**1. MOMENTO DA EMPRESA (últimas 8 semanas)**
- O que aconteceu de relevante? (funding, produto, parceria, expansão, contratação)
- Está crescendo, estável ou passando por desafio?
- Qual a evidência mais concreta desse momento?

**2. MOMENTO DO PROSPECT (pessoa)**
- Posts recentes: sobre o quê está falando?
- Preocupações explícitas ou implícitas nos posts?
- Há quanto tempo está no cargo? (novos líderes tomam decisões rápido)
- Alguém saiu da empresa recentemente? (mudança = oportunidade)

**3. SINAIS DE COMPRA DETECTADOS**
- Sinal quente: [específico e recente]
- Sinal morno: [indica intenção mas não imediata]
- Ausência de sinal: [o que não encontrou]

**4. TECH STACK IDENTIFICADA**
- Ferramentas que usam (LinkedIn, site, job postings)
- Integração possível com o produto que estou oferecendo

**5. ÂNGULO DE HOOK RECOMENDADO**
- Hook A (baseado no sinal mais forte): "[esboço de primeira linha]"
- Hook B (alternativo): "[esboço de primeira linha]"
- Por que esses hooks vão funcionar para este prospect

**6. RISCOS**
- Algum concorrente já está atendendo eles?
- Alguma informação que sugere que NÃO é o momento certo?
- Deveria esperar ou abordar agora?

**7. SCORE DE TIMING (1-10)**
- 8-10: Abordar agora — sinal quente
- 5-7: Abordar com ângulo de nutrição
- 1-4: Aguardar — adicionar à lista de nurturing
```

## Exemplo de uso

### Input
Prospect: Ricardo Alves, CTO, FinPay
LinkedIn: linkedin.com/in/ricardoalves-cto
Fontes (RAG): Post há 5 dias sobre "como documentar processos com time crescendo", FinPay anunciou R$12M série A há 3 semanas, 4 vagas abertas para engenheiros sênior

### Output
**Momento da empresa:** Acabou de fechar série A (R$12M, 3 semanas atrás). Contratando engenheiros para expandir produto. Crescimento acelerado = pressão operacional.

**Momento do prospect:** Ricardo postou há 5 dias sobre dificuldade de documentar processos com time crescendo — dor explícita, recente e pública.

**Sinal de compra:** QUENTE — líder técnico expressando publicamente a dor exata que nosso produto resolve, em momento de expansão acelerada.

**Hook recomendado:** "Vi seu post sobre documentar processos quando o time cresce — é exatamente o que acontece depois de uma série A."

**Score de timing:** 9/10 — abordar agora.

---
**Tags:** Avançado | Inteligência | Comercial, RAG, Personalização, Outbound
