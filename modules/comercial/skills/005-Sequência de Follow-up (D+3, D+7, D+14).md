---
name: sequencia-de-follow-up-d3-d7-d14
description: Criar a sequência completa de follow-up após o email inicial — toques no D+3, D+7 e D+14 com ângulos diferentes, sem repetir a mesma abordagem — estruturada para o pipeline de follow-up automático do VRAXIA com controle de estado no outbound-log.
tags: [follow-up, sequência, d+3, d+7, outbound, pipeline, outbound-log, automação]
---

# Sequência de Follow-up (D+3, D+7, D+14)

## Objetivo
Criar a sequência completa de follow-up após o email inicial — 3 toques nos dias 3, 7 e 14 com ângulos completamente diferentes, sem parecer insistente — estruturada para o sistema de follow-up automático do VRAXIA que lê o `outbound-log.json` e dispara via Resend no horário configurado.

## Quando usar
- Após o email inicial (D+0) sem resposta
- Para configurar o `follow-up-scheduler` do VRAXIA com os templates
- Quando precisa criar variações por segmento (fintech vs agência vs SaaS)
- Para o Analytics Agent monitorar qual toque gerou mais respostas

## Como usar
1. Defina o email inicial (skill 004)
2. Passe o contexto do prospect e o email inicial para este prompt
3. Receba os 3 follow-ups prontos com subjects distintos
4. Configure no `outbound-log.json` como `followup_d3`, `followup_d7`, `followup_d14`
5. O pipeline do VRAXIA dispara automaticamente por dia relativo

## O Prompt
```
Você é especialista em sequências de follow-up B2B. A maioria das vendas acontece após o 3º toque, mas a maioria desiste no 1º. O segredo: cada follow-up deve ter UM ângulo diferente e nunca perguntar "viu meu email anterior?".

REGRAS:
- Cada follow-up máximo 80 palavras
- Ângulo diferente em cada toque (não repetir a proposta)
- D+3: nova prova / caso de uso específico
- D+7: ângulo de custo de não agir / urgência real
- D+14: break-up gentil que muitas vezes gera resposta
- Nunca mencionar "conforme email anterior" ou "só passando para checar"

**CONTEXTO DO PROSPECT:**
- Nome: [primeiro nome]
- Cargo/Empresa: [cargo e empresa]
- Email inicial enviado em: [data D+0]
- Assunto do email inicial: [subject]
- Principal dor endereçada: [dor]
- Produto oferecido: [produto/serviço]

**RESULTADO JÁ OBTIDO COM CLIENTE SIMILAR:**
[case ou dado concreto para usar como prova no D+3]

Entregue:

**FOLLOW-UP D+3 (Nova prova de valor)**
- Subject:
- Corpo (máx 80 palavras):

**FOLLOW-UP D+7 (Custo de não agir)**
- Subject:
- Corpo (máx 80 palavras):

**FOLLOW-UP D+14 (Break-up gentil)**
- Subject:
- Corpo (máx 80 palavras):

**CONFIGURAÇÃO PARA O OUTBOUND-LOG DO VRAXIA:**
```json
{
  "followup_d3": { "subject": "", "body": "" },
  "followup_d7": { "subject": "", "body": "" },
  "followup_d14": { "subject": "", "body": "", "isBreakup": true }
}
```
```

## Exemplo de uso

### Input
Prospect: Ricardo, CTO, FinPay | Dor: documentação manual com time crescendo
Email D+0: subject "documentação de processos quando o time dobra de tamanho"
Case para D+3: cliente Nubank-similar reduziu 60% do tempo de documentação em 4 semanas

### Output
**D+3 — Subject:** "como a [fintech similar] automatizou o onboarding de engenheiros"
Corpo: Ricardo, quis compartilhar rapidamente: uma fintech com stack parecida com a da FinPay usou o VRAXIA OS para automatizar o onboarding técnico de novos devs — caiu de 3 semanas para 4 dias. Faria sentido te mostrar como ficou? 15 minutos seria o suficiente.

**D+7 — Subject:** "cada semana sem isso custa quanto?"
Corpo: Ricardo, sei que a agenda de CTO é brutal. Só quero deixar uma coisa: enquanto o processo de documentação for manual, cada engenheiro novo que entra demora X semanas até ser produtivo. Calculamos esse custo com outros CTOs — o número costuma surpreender. Quer ver o cálculo?

**D+14 — Subject:** "vou parar de incomodar (mas quero te deixar algo)"
Corpo: Ricardo, sem resposta, entendo que não é prioridade agora. Não vou mais mandar emails. Mas deixo o material aqui caso mude: [link]. Se um dia fizer sentido, estarei disponível. Boa sorte com os 3 novos engenheiros!

---
**Tags:** Avançado | Sequência | Comercial, Follow-up, Pipeline
