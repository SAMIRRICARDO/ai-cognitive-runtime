---
name: qualificacao-bant-por-ia-discovery-estruturado
description: Estruturar e executar um discovery de qualificação BANT (Budget, Authority, Need, Timeline) com perguntas estratégicas por cargo e setor — gerando um scorecard de qualificação que define se o prospect entra no pipeline ativo ou vai para nurturing.
tags: [qualificação, bant, discovery, perguntas, pipeline, scorecard, decisor, b2b]
---

# Qualificação BANT por IA (Discovery Estruturado)

## Objetivo
Estruturar um discovery de qualificação usando o framework BANT adaptado para SaaS/serviços B2B — com perguntas estratégicas específicas por cargo do prospect — e gerar um scorecard que define automaticamente se o lead vai para pipeline ativo, nurturing ou descarte.

## Quando usar
- Antes da primeira call de qualificação com um prospect
- Para preparar o SDR ou o agente Comercial AI para a conversa
- Quando um prospect responde ao email e pede mais informações
- Para padronizar o critério de qualificação em toda a equipe

## Como usar
1. Passe o cargo do prospect e o produto sendo vendido
2. O Comercial AI gera o roteiro de perguntas de discovery
3. Use na call ou adapte para um formulário de auto-qualificação
4. Preencha o BANT scorecard após a conversa
5. O Orchestrator Agent usa o scorecard para priorizar o pipeline

## O Prompt
```
Você é um especialista em qualificação de vendas B2B. Qualificação mal feita desperdiça o tempo do closer com prospects que nunca vão comprar. Qualificação bem feita faz o pipeline preditivo.

BANT ADAPTADO PARA [produto/serviço]:
- Budget: a empresa tem recurso/orçamento disponível ou viabilidade de alocar?
- Authority: estou falando com quem decide ou preciso mapear outros stakeholders?
- Need: a dor é real, urgente e o produto resolve de verdade?
- Timeline: quando pretendem resolver isso?

**PRODUTO/SERVIÇO SENDO QUALIFICADO:** [descreva]
**TICKET MÉDIO/MODELO DE PREÇO:** [valor e estrutura]
**CARGO DO PROSPECT NA CALL:** [cargo]
**O QUE JÁ SEI SOBRE ELE:** [o que veio do enrichment/RAG]

Gere o roteiro de discovery completo:

**ABERTURA (estabelecer rapport e contexto):**
[2 perguntas para começar]

**NEED — Identificar e aprofundar a dor:**
[5-7 perguntas progressivas — do superficial ao específico]
Use a técnica: Situação → Problema → Implicação → Necessidade de solução

**AUTHORITY — Mapear o processo de decisão:**
[3-4 perguntas para entender quem mais está envolvido]

**BUDGET — Validar viabilidade financeira (sem constranger):**
[3 perguntas indiretas que revelam budget sem perguntar "qual é seu orçamento?"]

**TIMELINE — Entender urgência:**
[3 perguntas para calibrar urgência real]

**BANT SCORECARD (preencher após a call):**
| Critério | Score (1-5) | Observações |
|---|---|---|
| Need — dor real e urgente | | |
| Authority — decisor ou influência direta | | |
| Budget — viabilidade confirmada | | |
| Timeline — menos de 90 dias | | |
| Fit técnico com o produto | | |

**CLASSIFICAÇÃO DO SCORECARD:**
- 20-25 pontos: SQL — mover para proposta imediatamente
- 14-19 pontos: MQL — nurturing ativo + próxima call em 30 dias
- <14 pontos: Desqualificado — colocar em lista de nurturing passivo

**PRÓXIMO PASSO RECOMENDADO:**
[Com base na classificação, qual o próximo passo no pipeline]
```

## Exemplo de uso

### Input
Produto: VRAXIA OS | Ticket: R$4.900-R$19.900/mês | Cargo: CTO de fintech 80 funcionários

### Output
**Abertura:** "Ricardo, você chegou ao VRAXIA através do nosso email — o que chamou sua atenção especificamente?" → "Antes de qualquer coisa, pode me contar como está a operação hoje para que eu saiba o que faz sentido mostrar?"

**Need:** "Quais as tarefas que mais consomem tempo do seu time de engenharia hoje que não são desenvolvimento de produto?" → "Qual o custo disso — se você tivesse que estimar as horas por semana?" → "Isso já travou alguma entrega importante?" → "Se esse problema continuar por mais 6 meses, o que acontece?"

**Authority:** "Esse tipo de solução — quem mais precisaria estar envolvido na avaliação?" → "O CEO ou VP de Produto participaria da decisão ou você tem autonomia?" → "Vocês têm algum processo formal de aprovação de novas ferramentas?"

**Budget:** "Vocês já usam alguma ferramenta paga hoje para automação de processos? Qual o investimento atual?" → "Qual é a ordem de grandeza de uma solução que faria sentido — pensando no retorno que geraria?" → "A série A trouxe orçamento específico para eficiência operacional?"

**Timeline:** "Qual a urgência para resolver isso — é uma dor que dói agora ou algo para planejar?" → "Tem algum evento nos próximos 90 dias que tornaria isso mais urgente?" → "Se decidissem agora, quando gostariam de estar usando?"

---
**Tags:** Intermediário | Framework | Comercial, Qualificação, BANT, Pipeline
