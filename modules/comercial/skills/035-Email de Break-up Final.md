---
name: email-de-break-up-final
description: Gerar o email de break-up final para um prospect que ficou em silêncio após todos os toques da sequência — com tom direto, não ressentido, e uma última pergunta de qualificação — que fecha o ciclo de forma digna e muitas vezes surpreendentemente gera resposta de prospects que ignoraram todos os anteriores.
tags: [break-up, follow-up, silêncio, fechamento de ciclo, email-sender, last chance, pipeline, outbound]
---

# Email de Break-up Final

## Objetivo
Gerar o email de break-up final — último contato antes de remover um prospect do pipeline ativo — com tom direto, não desesperado, que fecha o ciclo de forma digna. O break-up paradoxalmente gera mais respostas do que todos os follow-ups anteriores, pois remove a pressão e força o prospect a dar uma posição clara.

## Quando usar
- Após D+14 da sequência de follow-up sem resposta (skill 005, 3º toque)
- Quando um prospect parou de responder após demonstrar interesse inicial
- Para fechar formalmente ciclos de 60+ dias sem decisão
- Para liberar o slot mental do closer antes de um novo ciclo

## Como usar
1. O Analytics Agent identifica prospects no D+14 sem resposta
2. O email-sender dispara o break-up automaticamente
3. Se houver resposta → re-qualificar com BANT (skill 011)
4. Se não houver resposta → mover para nurturing passivo no outbound-log
5. Registrar motivo do break-up no outbound-log para análise futura

## O Prompt
```
Você é especialista em ciclo de vendas B2B. O email de break-up é contraintuitivo: ao demonstrar que você está OK com o "não", remove a pressão e faz o prospect se sentir confortável para responder — mesmo que negativamente.

REGRAS DO BREAK-UP:
- Nunca culpar o prospect pelo silêncio
- Nunca pedir "só mais 5 minutos"
- Comunicar que é o último contato (isso gera urgência genuína)
- Deixar uma saída honrosa — pergunta que o prospect pode responder em 1 linha
- Tom: colega encerrando uma conversa, não vendedor desesperado
- Máximo 5 frases
- NÃO incluir links, PDFs ou materiais

**PROSPECT:**
- Nome: [primeiro nome]
- Cargo: [cargo]
- Empresa: [empresa]
- Último contato real: [quando e o que foi dito/enviado]
- Número de toques sem resposta: [N]
- O que foi oferecido: [produto/proposta]

Gere 3 variações de break-up:

**VARIAÇÃO A — Direta e simples:**
Assunto: Encerrando por aqui, [Nome]
Corpo: [3-4 frases — fecha o ciclo + pergunta final]

**VARIAÇÃO B — Com contexto (para quando houve interesse anterior):**
Assunto: [referência à conversa inicial]
Corpo: [reconhece o que foi discutido + fecha + pergunta]

**VARIAÇÃO C — Ultra-curta (para ciclos muito longos):**
Assunto: [Nome] — última mensagem
Corpo: [2-3 frases, sem contexto, apenas fecha]

REGRAS PARA TODAS:
- Nenhuma palavra "ocupado/a" (clichê — soa sarcástico)
- Nenhuma "última tentativa" (manipulação óbvia)
- Uma única pergunta, fechada, no final
- Assunto curto — sem números ou urgência fake
```

## Exemplo de uso

### Input
Prospect: Carlos, CFO, MetalBras (150 funcionários, indústria)
Histórico: respondeu positivamente ao cold email em D+0, sumiu após proposta enviada em D+7
Toques sem resposta: 2 (D+3 follow-up + D+7 proposta)
Produto: VRAXIA OS plano Professional

### Output
**Variação A (recomendada):**
Assunto: Encerrando por aqui, Carlos

Carlos, boa tarde.

Enviei a proposta há 3 semanas e não consegui mais contato — entendo que o timing pode não ser o certo agora.

Vou encerrar por aqui para não tomar mais do seu tempo.

Antes de fechar: prioridades mudaram e faz sentido retomar mais pra frente, ou não faz sentido para vocês?

Samir

---

**Variação B:**
Assunto: Re: nossa conversa sobre automação na MetalBras

Carlos, quando conversamos você mencionou que 20h/semana de operações manuais eram um problema real.

Tentei entrar em contato algumas vezes desde a proposta — imagino que algo mais urgente tenha chegado na frente.

Este é meu último contato: faz sentido revisitar em outro momento, ou a prioridade mudou?

---

**Variação C:**
Assunto: Carlos — última mensagem

Vou encerrar por aqui.

Se algum dia o tema de automação de processos voltar à tona na MetalBras, estarei disponível.

Ainda faz sentido isso para vocês?

---
**Tags:** Intermediário | Fechamento | Comercial, Break-up, Follow-up, Pipeline, Email
