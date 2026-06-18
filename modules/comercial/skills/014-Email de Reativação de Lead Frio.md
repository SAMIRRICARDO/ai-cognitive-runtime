---
name: email-de-reativacao-de-lead-frio
description: Reativar um lead que ficou sem resposta por 30-90 dias — com um email de 3 linhas que provoca curiosidade sem ser insistente — usando uma nova perspectiva, um resultado recente ou uma mudança de contexto como gatilho de reabertura.
tags: [reativação, lead frio, nurturing, cold, email-sender, follow-up tardio, pipeline, outbound]
---

# Email de Reativação de Lead Frio

## Objetivo
Reativar leads que pararam de responder após contatos iniciais — sem ser repetitivo ou parecer desesperado. A chave é um novo gatilho (case novo, mudança no mercado, notícia da empresa do prospect) que justifica a reabertura da conversa com uma perspectiva diferente. Enviado via `email-sender` do VRAXIA.

## Quando usar
- Leads que não responderam ao follow-up D+3, D+7, D+14 (skill 005)
- Prospects que sumiram após uma demo ou proposta enviada
- Leads qualificados que pediram "me contate em X meses" e o prazo chegou
- Base de contatos fria (90+ dias) que precisa de reativação

## Como usar
1. O Analytics Agent identifica leads inativos há 30-90 dias no outbound-log
2. O RAG Agent busca novos gatilhos (news, posts recentes do prospect)
3. Este prompt gera o email de reativação com o novo ângulo
4. O email-sender dispara e o Analytics Agent monitora resposta
5. Se não houver resposta após este email, o lead vai para nurturing passivo

## O Prompt
```
Você é especialista em reativação de pipeline B2B. Um email de reativação tem que parecer que você está genuinamente lembrando deles por um motivo novo — não que você está mandando o email 7 no mesmo pitch.

A fórmula que funciona: nova informação + conexão com o prospect + uma pergunta simples.

**PROSPECT:**
- Nome: [primeiro nome]
- Cargo: [cargo]
- Empresa: [empresa]
- Último contato: [quando e o que foi discutido]
- Por que parou: [não respondeu / pediu para retornar / viu proposta e sumiu]

**NOVO GATILHO PARA REATIVAÇÃO (escolha o mais forte):**
□ Novo case de cliente similar ao prospect
□ Mudança relevante no mercado/setor deles
□ Notícia recente da empresa do prospect
□ Nova funcionalidade ou módulo lançado
□ Dado novo (benchmark, pesquisa) relevante para o cargo deles
□ Data sazonal relevante (Q4, virada de ano, período de planejamento)

**GATILHO ESPECÍFICO:** [descreva o que aconteceu]

Gere 3 variações de email de reativação (escolha a mais natural):

**VARIAÇÃO A — Novo case (prova social)**
Assunto: [assunto com curiosidade, sem spam]
Corpo: [3-4 linhas — case + conexão com o prospect + pergunta]

**VARIAÇÃO B — Mudança de contexto/mercado**
Assunto:
Corpo:

**VARIAÇÃO C — Direta e sem desculpa**
Assunto:
Corpo: [a mais curta — reconhece que sumiu, dá motivo, faz pergunta]

REGRAS PARA TODAS:
- Máximo 5 frases
- Nenhuma desculpa pelo tempo que passou (sinaliza fraqueza)
- Uma pergunta no final — nunca uma afirmação "me ligue"
- Tom de colega, não de vendedor
- Referência genuína à conversa anterior
```

## Exemplo de uso

### Input
Prospect: Thiago, CFO, MetalBras (indústria, 150 funcionários)
Último contato: proposta enviada há 47 dias, sumiu após responder "vou analisar"
Gatilho: MetalBras anunciou nova unidade fabril em Campinas (notícia no LinkedIn)

### Output
**Variação A (recomendada):**
Assunto: Thiago — vimos a notícia da nova unidade em Campinas

Thiago, boa tarde. Vi a notícia da expansão para Campinas — parabéns, é um movimento estratégico relevante.

Isso me fez pensar: a abertura de uma nova unidade normalmente gera uma camada nova de processos que precisam ser estruturados do zero. Com a VRAXIA, clientes em expansão normalmente usam esse momento para padronizar automações antes que os problemas escalam junto com a operação.

Ainda faz sentido retomarmos a conversa da proposta que enviei, agora com esse contexto novo?

---
**Tags:** Intermediário | Template | Comercial, Reativação, Email, Pipeline
