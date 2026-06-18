---
name: validador-de-email-corporativo-dmarc-mx
description: Validar emails corporativos de prospects via verificação MX, DMARC e padrões de domínio antes do disparo — usando a infraestrutura do EmailPatternResolver do VRAXIA para garantir deliverability acima de 95% e proteger a reputação do domínio remetente.
tags: [validação, email, dmarc, mx, deliverability, reputação, emailpatternresolver]
---

# Validador de Email Corporativo (DMARC + MX)

## Objetivo
Validar emails corporativos de prospects antes do disparo — verificando registros MX, DMARC, padrões de domínio e pontuação de risco — usando a infraestrutura de validação do VRAXIA para garantir deliverability acima de 95% e proteger a reputação do domínio remetente (`vrashows.com.br` ou domínio configurado).

## Quando usar
- Sempre antes de adicionar um lead ao `outbound-log.json`
- Quando o `EmailPatternResolver` retorna múltiplos padrões possíveis
- Ao importar listas de fontes externas (Apollo, Hunter, LinkedIn)
- Quando a taxa de bounce de uma campanha ultrapassa 2%
- Para diagnóstico de problemas de entregabilidade

## Como usar
1. Passe a lista de emails para o Validator Agent do VRAXIA
2. O agente executa verificação MX + DMARC + padrão
3. Emails com score < 0.6 são descartados ou movidos para fallback
4. Emails válidos são marcados com `emailConfidence` no payload do lead
5. Use o resultado para ajustar o `EmailPatternResolver` com novos padrões

## O Prompt
```
Você é um especialista em deliverability de email e reputação de domínio. No outbound B2B, uma taxa de bounce acima de 3% começa a destruir a reputação do remetente — o que afeta todos os envios futuros, inclusive os válidos.

Analise e valide os seguintes emails/domínios para prospecção outbound:

**Lista para validar:**
[cole os emails ou domínios, um por linha]

**Domínio remetente que vou usar:** [ex: vrashows.com.br]
**Volume de envio previsto:** [emails por dia]
**Ferramenta de envio:** [Resend / SendGrid / AWS SES]

Para cada email/domínio, entregue:

**1. VERIFICAÇÃO TÉCNICA**
- Registro MX: existe? (domínio recebe email?)
- Registro DMARC: existe? qual política? (none/quarantine/reject)
- Registro SPF: configurado?
- Catchall: domínio aceita qualquer email? (risco alto)
- Disposable: é email temporário?

**2. SCORE DE CONFIANÇA (0.0 a 1.0)**
- 0.9-1.0: Email confirmado, enviar
- 0.7-0.89: Alta probabilidade, enviar
- 0.5-0.69: Incerto, testar com volume baixo
- <0.5: Descartar ou buscar email alternativo

**3. ANÁLISE DE PADRÃO DO DOMÍNIO**
Se verificar múltiplos emails de mesmo domínio:
- Qual padrão predomina? (nome.sobrenome vs n.sobrenome vs nome)
- Adicionar ao EmailPatternResolver

**4. AÇÃO RECOMENDADA POR EMAIL**
- ENVIAR | TESTAR | DESCARTAR | BUSCAR_ALTERNATIVO

**5. DIAGNÓSTICO DE DELIVERABILITY**
Se a lista toda tiver problemas:
- Causa raiz
- Como resolver antes de disparar
- Configurações a checar no Resend/domínio remetente

**6. CONFIGURAÇÃO DKIM/DMARC DO REMETENTE**
Se detectar vulnerabilidade no domínio remetente:
- Records a adicionar no DNS
- Política DMARC recomendada para outbound frio
```

## Exemplo de uso

### Input
Lista: joao.silva@techcorp.com.br, contato@startup.io, ceo@empresa.com, hello@maildrop.cc
Remetente: vrashows.com.br | Volume: 50 emails/dia | Ferramenta: Resend

### Output
| Email | MX | DMARC | Catchall | Score | Ação |
|---|---|---|---|---|---|
| joao.silva@techcorp.com.br | ✓ | quarantine | Não | 0.92 | ENVIAR |
| contato@startup.io | ✓ | none | Sim | 0.55 | TESTAR |
| ceo@empresa.com | ✓ | reject | Não | 0.88 | ENVIAR |
| hello@maildrop.cc | ✓ | — | — | 0.05 | DESCARTAR |

Padrão detectado em techcorp.com.br: `nome.sobrenome` (3/3 confirmados)
→ Adicionar ao EmailPatternResolver com confidence 0.9

---
**Tags:** Técnico | Validação | Comercial, Email, Deliverability
