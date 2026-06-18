---
name: dm-linkedin-pos-conexao-pitch-em-3-toques
description: Criar a sequência de 3 DMs no LinkedIn após o aceite de conexão — toque de boas-vindas, toque de valor e toque de proposta — sem parecer spam, com progressão natural que leva o prospect a pedir mais informações ou aceitar uma call.
tags: [linkedin, dm, direct message, sequência, social selling, linkedin-sender, pitch, outbound]
---

# DM LinkedIn Pós-Conexão (Pitch em 3 Toques)

## Objetivo
Criar a sequência de 3 DMs no LinkedIn após o aceite de conexão — com progressão natural do relacionamento até a proposta — sem parecer robótico ou spam. Cada mensagem tem um objetivo diferente e respeita o contexto da conversa. Saída compatível com o `linkedin-sender` do VRAXIA.

## Quando usar
- Logo após o prospect aceitar o convite de conexão
- Para criar o corpus de DMs de follow-up do `linkedin-sender`
- Em sequências multicanal onde o email já foi enviado (LinkedIn como reforço)
- Quando o prospect é 1º grau mas nunca interagiu com emails

## Como usar
1. O `linkedin-sender` detecta o aceite de conexão no LinkedIn
2. Agenda automaticamente os 3 toques (D+1, D+4, D+9 do aceite)
3. Este prompt gera o corpo de cada mensagem
4. O agente injeta via Chrome profile na sessão configurada
5. Respostas do prospect são detectadas e pausam a sequência

## O Prompt
```
Você é especialista em social selling e DM no LinkedIn. O erro mais comum: mandar o pitch imediatamente após a conexão. Isso destrói a taxa de resposta. A sequência certa aquece o relacionamento antes de abrir qualquer oferta.

REGRAS:
- DM 1 (D+1 do aceite): boas-vindas + algo de valor, SEM pitch. Máx 60 palavras.
- DM 2 (D+4): conteúdo ou insight relevante para o cargo/setor. Máx 80 palavras.
- DM 3 (D+9): proposta de conversa, leve e com opção de "não". Máx 100 palavras.
- Nunca usar "prezado/a", nunca parecer template, sempre referência ao perfil

**PROSPECT:**
- Nome: [primeiro nome]
- Cargo: [cargo]
- Empresa: [empresa]
- Setor: [setor]
- Dor principal do cargo/setor: [dor]
- Seu produto/serviço: [o que oferece]
- Resultado concreto que pode mencionar: [case ou dado]

**CONTEXTO DA CONEXÃO:**
[o que foi mencionado na mensagem de convite — para manter continuidade]

Entregue:

**DM 1 — Boas-vindas + Valor (D+1 do aceite)**
Objetivo: criar boa impressão, gerar reciprocidade, NÃO vender
Corpo:

**DM 2 — Insight + Prova (D+4)**
Objetivo: mostrar que entende o mundo do prospect, construir autoridade
Corpo:

**DM 3 — Proposta de Conversa (D+9)**
Objetivo: propor uma call de 20min de forma leve, com saída fácil
Corpo:

**CONFIGURAÇÃO LINKEDIN-SENDER (VRAXIA):**
```json
{
  "tipo": "dm_sequencia",
  "toques": [
    { "dia": 1, "mensagem": "" },
    { "dia": 4, "mensagem": "" },
    { "dia": 9, "mensagem": "" }
  ],
  "pausarSeResponder": true,
  "prospectLinkedin": ""
}
```
```

## Exemplo de uso

### Input
Prospect: Marina, Head of Revenue, SalesFlow
Dor: escalar SDR sem perder qualidade | Produto: VRAXIA OS (automação outbound)
Case: cliente com time de 5 SDRs processou 3x mais leads com IA

### Output
**DM 1 (D+1):** "Marina, obrigado por conectar! Vi que você veio de [empresa anterior] antes da SalesFlow — trajetória interessante em Revenue. Se algum dia quiser trocar experiências sobre escalar times de vendas com IA, estou por aqui."

**DM 2 (D+4):** "Marina, um dado que achei relevante para Head of Revenue em SaaS: times que automatizam a qualificação de leads com IA respondem 3x mais rápido após um demo (dados HubSpot 2024). Estamos vendo isso na prática com clientes aqui. Deve estar sentindo algo similar com os SDRs da SalesFlow?"

**DM 3 (D+9):** "Marina, trabalhei com 3 empresas de SaaS B2B de 50-150 funcionários que aumentaram o throughput do time de Revenue sem contratar. O que fizemos foi automatizar a camada de qualificação e follow-up com agentes IA. Faria sentido uma call de 20 minutos para te mostrar o que aplicamos? Sem compromisso — se não fizer sentido pra SalesFlow, pelo menos fica o benchmarking."

---
**Tags:** Avançado | Sequência | Comercial, LinkedIn, DM, Outbound
