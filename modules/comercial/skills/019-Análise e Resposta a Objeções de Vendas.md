---
name: analise-e-resposta-a-objecoes-de-vendas
description: Identificar o tipo de objeção recebida (preço, timing, concorrente, autoridade, risco), classificar se é objeção real ou sinal de não-qualificação, e gerar a resposta específica que avança a conversa — com argumentos, perguntas de desbloqueio e oferta de saída digna.
tags: [objeções, vendas, resposta, preço, concorrente, timing, negociação, fechamento]
---

# Análise e Resposta a Objeções de Vendas

## Objetivo
Classificar a objeção recebida de um prospect, distinguir objeção real (barreira específica que pode ser superada) de pseudo-objeção (sinal de desqualificação ou forma gentil de dizer não) — e gerar a resposta ideal que avança a conversa ou fecha de forma digna. Elimina improvisos e padroniza as respostas do time comercial.

## Quando usar
- Quando um prospect levanta uma objeção por email, DM ou call
- Para treinar o time com as objeções mais comuns do segmento
- Para preparar o closer antes de uma reunião de negociação
- Quando um prospect sumiu após a proposta (objeção não verbalizada)

## Como usar
1. Cole a objeção exata do prospect (palavras dele)
2. O Comercial AI classifica e gera a resposta ideal
3. Revise e envie via email-sender ou use como script de call
4. Registre a objeção e a resposta no outbound-log para análise posterior

## O Prompt
```
Você é um especialista em qualificação e negociação B2B. Objeções são informação — elas revelam onde está o gap de valor, de confiança ou de timing. Seu trabalho é classificar a objeção e gerar a resposta mais inteligente.

**OBJEÇÃO RECEBIDA (palavras exatas do prospect):**
[cole aqui]

**CONTEXTO:**
- Estágio no pipeline: [proposta enviada / após demo / negociação / cold email]
- Produto/serviço: [o que está sendo vendido]
- O que o prospect já sabe: [o que foi compartilhado até agora]
- ICP score deste prospect: [se disponível]

**CLASSIFICAÇÃO DA OBJEÇÃO:**

Tipo:
□ Preço / Investimento
□ Timing ("agora não é a hora")
□ Autoridade ("preciso falar com X")
□ Concorrente ("já usamos Y")
□ Risco / Confiança ("não sei se vai funcionar")
□ Necessidade ("não sei se precisamos disso")
□ Pseudo-objeção (não quer dizer não diretamente)

É real ou pseudo?
- REAL: existe uma barreira específica que pode ser abordada
- PSEUDO: o prospect já decidiu que não quer, está usando educação

**SE FOR OBJEÇÃO REAL:**

Causa raiz provável: [por que estão levantando isso — o que está por trás]

Resposta A (reconhecer + reencadrar):
[3-4 frases — valide a objeção, reencadre, faça uma pergunta]

Resposta B (dados + prova social):
[use um case ou dado que dissolve a objeção]

Pergunta de desbloqueio:
[uma pergunta que convida o prospect a resolver junto com você]

**SE FOR PSEUDO-OBJEÇÃO:**
Não tente superar — confirme se é um não e ofereça saída digna:
[mensagem curta que fecha o ciclo sem queimar o relacionamento]

**PRÓXIMO PASSO RECOMENDADO APÓS A RESPOSTA:**
[o que você pede como próximo passo concreto]
```

## Exemplo de uso

### Input
Objeção: "Gostei muito, mas o valor está um pouco acima do que planejamos para agora."
Estágio: proposta enviada | Produto: VRAXIA OS R$4.900/mês | ICP Score: 78

### Output
**Tipo:** Preço / Investimento
**Classificação:** REAL — alta probabilidade (ICP Score 78, estágio avançado, usaram "agora" = timing mais que preço)

**Causa raiz:** Budget não foi formalizado para o produto específico, não necessariamente falta de dinheiro.

**Resposta A (reencadrar):**
"Entendo, Rafael. Quando você diz 'acima do planejado', me ajuda a entender: é uma questão de orçamento do trimestre ou do valor em si não fazer sentido dado o retorno? Pergunto porque para empresas do porte da [empresa] o payback costuma ser em menos de 30 dias — e isso muda a conversa de 'custo' para 'quando começo a recuperar'."

**Resposta B (prova social):**
"Faz sentido a cautela. Um CFO de SaaS B2B que tínhamos como cliente disse exatamente isso. Saiu do trial em 2 semanas depois de ver 18h/semana eliminadas do time de ops. Posso te mostrar os números desse caso?"

**Pergunta de desbloqueio:**
"Se o retorno fosse demonstrado dentro de 30 dias, o investimento ainda seria um impeditivo?"

**Próximo passo:** Propor um trial pago de 30 dias com garantia de resultado ou devolução.

---
**Tags:** Avançado | Negociação | Comercial, Objeções, Fechamento, Qualificação
