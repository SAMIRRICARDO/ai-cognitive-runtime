---
name: email-de-apresentacao-institucional-com-pdf
description: Gerar o email de apresentação institucional enviado após o primeiro contato positivo — com corpo persuasivo em 3 parágrafos e instruções para anexar o PDF da proposta — usando o email-sender do VRAXIA com o domínio vrashows.com.br validado via Resend.
tags: [email, institucional, apresentação, pdf, resend, email-sender, follow-up, inbound]
---

# Email de Apresentação Institucional com PDF

## Objetivo
Gerar o email de apresentação formal enviado quando um prospect demonstrou interesse inicial — seja respondendo a um cold email, clicando em um link, ou pedindo mais informações. O email deve ter corpo persuasivo e ser o veículo para entregar o PDF de apresentação da solução. Enviado via `email-sender` do VRAXIA com Resend.

## Quando usar
- Quando um prospect responde ao cold email pedindo "mais informações"
- Após aceite de conexão no LinkedIn que evoluiu para interesse
- Como primeiro email para prospects inbound (formulário, indicação)
- Para warm leads que já conhecem a empresa mas nunca receberam material formal

## Como usar
1. Passe o contexto do prospect e o produto sendo apresentado
2. O Comercial AI gera o corpo do email em 3 parágrafos
3. Configure o PDF como attachment no `email-sender`
4. O email é disparado via Resend (domínio vrashows.com.br)
5. O Analytics Agent monitora abertura do email e do PDF

## O Prompt
```
Você é especialista em comunicação B2B executiva. Um email de apresentação que converte tem uma característica: é pessoal o suficiente para não parecer template, mas profissional o suficiente para gerar credibilidade.

ESTRUTURA (3 parágrafos + CTA):
- P1: Ponto de conexão com o que o prospect disse/fez + transição natural para o que você traz
- P2: O que entregamos especificamente para empresas como a deles (sem catálogo — 1-2 coisas concretas)
- P3: O que o PDF contém + chamada para a próxima ação
- CTA: Uma ação clara e simples

**CONTEXTO DO PROSPECT:**
- Nome: [primeiro nome]
- Cargo: [cargo]
- Empresa: [empresa]
- Como chegou até aqui: [o que aconteceu — cold email, linkedin, indicação]
- Dor ou interesse mencionado: [o que eles disseram]

**PRODUTO/SERVIÇO APRESENTADO:** [descreva]

**O QUE O PDF CONTÉM:** [resumo de 3-4 pontos do material]

**ASSINATURA:**
[Nome] | [Cargo] | VRASHOWS / VRAXIA OS
[email@vrashows.com.br] | vrashows.com.br

Gere:
**ASSUNTO:** [máx 55 caracteres — personalizado, sem spam words]

**CORPO:**
[P1 — 2-3 frases]

[P2 — 2-3 frases]

[P3 + CTA — 2-3 frases]

Att,
[assinatura]

**CONFIGURAÇÃO EMAIL-SENDER (VRAXIA):**
```json
{
  "to": "",
  "subject": "",
  "body": "",
  "attachments": [{ "filename": "VRAXIA-Apresentacao.pdf", "path": "./assets/vraxia-apresentacao.pdf" }],
  "from": "samir@vrashows.com.br",
  "provider": "resend",
  "trackOpen": true,
  "trackClick": true
}
```
```

## Exemplo de uso

### Input
Nome: Fernanda | Cargo: Head of Operations | Empresa: LogiFlow
Como chegou: respondeu cold email dizendo "interessante, pode mandar mais detalhes?"
Dor mencionada: "processos de logística ainda muito manuais"
Produto: VRAXIA OS — módulo Operações

### Output
**Assunto:** Fernanda, aqui está o que resolve o manual na LogiFlow

**Corpo:**
Fernanda, boa tarde. Fico feliz que o tema tenha ressoado — automação de operações é exatamente o que mais vejo travar empresas que já deveriam estar em outro patamar de eficiência.

Para a LogiFlow especificamente, o que costuma gerar mais impacto imediato é a camada de orquestração de processos recorrentes: eliminamos as 15-20 tarefas de "copy-paste entre sistemas" que os times de operações fazem todo dia, usando agentes IA que operam em background.

Estou anexando nossa apresentação — tem um caso de uso de logistics ops que pode ser bem próximo do seu cenário (página 4). Se fizer sentido, posso reservar 25 minutos para uma demo ao vivo na semana que vem. Há algum horário de preferência?

Att,
Samir Ricardo | Co-Founder | VRAXIA OS
samir@vrashows.com.br | vrashows.com.br

---
**Tags:** Iniciante | Template | Comercial, Email, Apresentação, PDF
