---
name: script-de-demo-e-apresentacao-do-produto
description: Estruturar e executar uma demo do VRAXIA OS para um prospect qualificado — com roteiro de 30 minutos dividido em rapport, diagnóstico ao vivo, demonstração focada na dor específica do prospect e proposta de próximo passo — personalizado com o contexto coletado pelo RAG Agent.
tags: [demo, apresentação, produto, roteiro, discovery, call, closer, pitch, vraxia]
---

# Script de Demo e Apresentação do Produto

## Objetivo
Estruturar uma demo de produto de 30 minutos para um prospect que passou pela qualificação e demonstrou interesse — personalizando o roteiro com o contexto coletado pelo RAG Agent (dores, tech stack, momento da empresa) e garantindo que a demo resolve a dor específica do prospect, não faz um tour genérico de funcionalidades.

## Quando usar
- Após marcar uma demo com um prospect qualificado (SQL)
- Para preparar o closer antes da call
- Para padronizar a demo entre múltiplos presenters
- Para criar versões de demo por vertical/segmento

## Como usar
1. Passe o contexto do prospect (RAG + discovery notes)
2. O Comercial AI gera o roteiro personalizado
3. Revise e ajuste para o tempo disponível (20-45 min)
4. Execute a demo e registre objeções encontradas
5. Use o BANT scorecard (skill 011) pós-demo para classificar

## O Prompt
```
Você é o presenter do VRAXIA OS. Uma demo que converte tem um princípio: o prospect deve sair sentindo que você mostrou a solução para o problema DELE, não um catálogo de funcionalidades.

ESTRUTURA (30 minutos):
- 0-5 min: Rapport + agenda
- 5-10 min: Diagnóstico ao vivo (perguntas rápidas)
- 10-22 min: Demo focada nas 2 dores mais relevantes
- 22-27 min: Case similar + ROI
- 27-30 min: Próximo passo

**PROSPECT:**
- Nome: [primeiro nome]
- Cargo: [cargo]
- Empresa: [empresa] ([porte])
- Dor principal (do RAG/discovery): [descreva]
- Segundo ponto de dor: [descreva]
- Tech stack atual: [o que usam hoje]
- Momento: [o que está acontecendo na empresa]

**PRODUTO SENDO DEMOED:**
VRAXIA OS — [quais módulos são mais relevantes para este prospect]

Gere o roteiro completo:

**0-5 MIN — ABERTURA:**
[rapport: 1 pergunta pessoal + validar agenda]
"[Nome], antes de começar — você mencionou [detalhe específico]. Ainda é a prioridade ou mudou algo?"
Slide: Capa com nome da empresa do prospect

**5-10 MIN — DIAGNÓSTICO RÁPIDO (perguntas):**
[2-3 perguntas para confirmar as dores e calibrar o foco]
Objetivo: O prospect fala mais do que você neste bloco

**10-22 MIN — DEMO (foco nas dores):**
Dor 1: [descreva o que mostrar] — [3-4 min]
Dor 2: [descreva o que mostrar] — [3-4 min]
[Módulo ou feature específica] — [2-3 min]
Frase de ancoragem: "Aquilo que você acabou de ver resolve exatamente o que você mencionou sobre [dor]"

**22-27 MIN — PROVA SOCIAL:**
"Empresa similar a vocês (mesmo setor/porte) — [o que fizeram] — resultado em [prazo]"
ROI: "[estimativa baseada no contexto deles]"

**27-30 MIN — PRÓXIMO PASSO:**
"Com base no que vimos, o que faz mais sentido como próximo passo para vocês?"
Opção A: Trial de 14 dias (módulo relevante)
Opção B: Proposta formal para os decisores
Opção C: Segunda call com [stakeholder específico]

**ARMADILHAS A EVITAR:**
[liste os erros específicos para este tipo de prospect]
```

## Exemplo de uso

### Input
Prospect: Julia (Head of Operations), 90 funcionários, SaaS
Dores: documentação manual, onboarding de novos contratados lento
Tech stack: Notion, Slack, GitHub — sem IA ainda
Módulos relevantes: Operações + Código + Conteúdo

### Output
**0-5 min:** "Julia, boa tarde! Você mencionou que a maior dor hoje é o tempo que o time perde documentando processos manualmente. Isso ainda é a prioridade ou surgiu algo desde que conversamos?"

**5-10 min (diagnóstico):** "Quando entra alguém novo, quanto tempo passa até estar produtivo de verdade?" / "O problema é falta de documentação, documentação desatualizada, ou as duas coisas?" / "Quem é responsável por manter isso hoje — é centralizado ou cada área cuida do seu?"

**Demo (10-22 min):**
- Dor 1 (documentação): Mostrar agente Operações gerando SOP de um processo em <2 min a partir de uma gravação de Loom
- Dor 2 (onboarding): Mostrar agente Conteúdo criando onboarding personalizado por cargo com base no repositório de docs existentes

**Ancoragem:** "Aquilo que você viu resolve exatamente o 'não temos tempo de documentar' — o agente faz isso em background enquanto o time continua trabalhando."

**Próximo passo:** "Faz sentido eu mandar uma proposta de trial de 14 dias focando nos módulos Operações e Conteúdo?"

---
**Tags:** Avançado | Vendas | Comercial, Demo, Apresentação, Closer, Pipeline
