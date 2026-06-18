---
name: mensagem-de-conexao-linkedin-1-grau
description: Criar mensagem de convite de conexão no LinkedIn para prospecção — personalizada com contexto do perfil do prospect, sem pitch imediato, com objetivo de aceitar a conexão para liberar a DM direta — integrada ao LinkedIn Sender do VRAXIA.
tags: [linkedin, conexão, prospecção, social selling, linkedin-sender, 1º grau, dm]
---

# Mensagem de Conexão LinkedIn (1º Grau)

## Objetivo
Criar a mensagem de convite de conexão no LinkedIn — personalizada com algo real do perfil do prospect (post recente, empresa, cargo), sem pitch de produto, com objetivo único de gerar o aceite e liberar o canal de DM para a próxima etapa. Saída formatada para o `linkedin-sender` do VRAXIA.

## Quando usar
- Quando o prospect ainda não é 1º grau no LinkedIn
- Para criar o corpus de mensagens do `linkedin-sender` antes de uma campanha
- Ao prospectar um segmento onde a taxa de resposta por email está abaixo de 5%
- Como primeiro toque de uma sequência multicanal (LinkedIn → Email → LinkedIn DM)

## Como usar
1. O Enricher Agent coleta o perfil LinkedIn do prospect
2. O RAG Agent extrai posts recentes, cargo, empresa, conquistas
3. Passa o contexto para este prompt
4. Recebe a mensagem de conexão pronta (máx 300 caracteres — limite LinkedIn)
5. O `linkedin-sender` do VRAXIA injeta e envia via Chrome profile configurado

## O Prompt
```
Você é especialista em social selling no LinkedIn. Mensagens de conexão que funcionam têm: (1) algo específico sobre a pessoa — NÃO genérico, (2) zero pitch de produto no primeiro contato, (3) deixam a pessoa curiosa ou com boa impressão, (4) máximo 300 caracteres (limite do LinkedIn).

REGRAS ABSOLUTAS:
- Nunca começar com "Oi, tudo bem?" ou "Olá, vi seu perfil"
- Nunca mencionar produto/serviço/solução na conexão
- Referenciar algo real: post, empresa, cargo, conquista, conteúdo
- Tom: profissional mas humano — como um colega de setor

**PROSPECT:**
- Nome: [primeiro nome]
- Cargo: [cargo exato]
- Empresa: [empresa]
- Algo específico do perfil: [post recente, artigo, empresa notável, conquista]
- Seu contexto: [quem você é e por que faz sentido a conexão]

Gere 3 variações de mensagem de conexão (máx 300 caracteres cada):

**VARIAÇÃO A (referência a conteúdo/post):**

**VARIAÇÃO B (referência à empresa/cargo):**

**VARIAÇÃO C (referência ao setor/momento):**

**RECOMENDAÇÃO:** qual das 3 tem maior probabilidade de aceite e por quê

**CONFIGURAÇÃO PARA O LINKEDIN-SENDER DO VRAXIA:**
```json
{
  "tipo": "conexao",
  "mensagem": "[variação escolhida]",
  "prospectLinkedin": "[URL do perfil]",
  "followupDias": 3
}
```
```

## Exemplo de uso

### Input
Prospect: Marina, Head of Revenue, SalesFlow (SaaS de CRM, 80 funcionários)
Post recente: Escreveu sobre os desafios de escalar um time de SDR sem perder qualidade
Meu contexto: Construo plataformas de automação de outbound com IA

### Output
**Variação A (melhor):** "Marina, li seu post sobre escalar SDR sem perder qualidade — exatamente o problema que mais vejo no segmento. Trabalho com Revenue Ops em SaaS e ia adorar trocar uma ideia sobre isso."

**Variação B:** "Marina, SalesFlow tem crescido bastante — acompanho o movimento de vocês. Atuo com automação de outbound para times de Revenue e queria conectar com quem está na linha de frente."

**Variação C:** "Marina, Head of Revenue em SaaS B2B é um dos cargos mais desafiadores do momento — escalar receita previsível sem aumentar custo. Trabalho com isso e ia adorar conectar."

**Recomendação:** Variação A — referência direta ao post cria pertinência imediata e mostra que não é mensagem em massa.

---
**Tags:** Intermediário | Template | Comercial, LinkedIn, Social Selling
