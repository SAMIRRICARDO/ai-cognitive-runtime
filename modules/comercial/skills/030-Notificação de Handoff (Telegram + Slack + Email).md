---
name: notificacao-de-handoff-telegram-slack-email
description: Configurar e usar o notifyManager do VRAXIA — sistema de notificação multi-canal para handoffs do pipeline de leads LinkedIn — que envia alertas instantâneos via Telegram, Slack, Email (Resend) ou console quando um lead qualificado exige atenção do closer humano.
tags: [handoff, notificação, telegram, slack, email, resend, closer, pipeline, alerta]
---

# Notificação de Handoff (Telegram + Slack + Email)

## Objetivo
Configurar o `notifyManager` do VRAXIA — sistema de notificação multi-canal que dispara automaticamente quando o `LeadClassifierAgent` detecta `handoff: true` — garantindo que o closer humano seja alertado instantaneamente via Telegram, Slack, Email (Resend via vrashows.com.br) ou console, sem precisar monitorar ativamente o pipeline.

## Quando usar
- Ao configurar o pipeline pela primeira vez (definir canal preferido)
- Para mudar o canal de notificação sem alterar o código (só .env)
- Quando o Telegram falha e precisa de fallback para console
- Para integrar o handoff com ferramentas externas de vendas

## Como usar
1. Defina `NOTIFY_CHANNEL` no `.env` com o canal preferido
2. Configure as credenciais do canal escolhido
3. O `notifyManager()` é chamado automaticamente pelo pipeline
4. Fallback automático para console se o canal falhar
5. Nunca para o pipeline em caso de falha de notificação

## O Prompt
```
Você é o engenheiro de integrações do VRAXIA. O notifyManager é o último passo do pipeline — quando ele falha, o lead pode ser perdido. Configure corretamente e teste antes de usar em produção.

**CONFIGURAÇÃO NO .ENV:**

Canal Telegram (recomendado — instantâneo):
```env
NOTIFY_CHANNEL=telegram
TELEGRAM_BOT_TOKEN=seu_bot_token_do_botfather
```
TELEGRAM_CHAT_ID está hardcoded em `tools/telegram.ts` (chat_id: 8135843555)

Canal Slack:
```env
NOTIFY_CHANNEL=slack
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

Canal Email (Resend):
```env
NOTIFY_CHANNEL=email
RESEND_API_KEY=re_sua_chave
NOTIFY_EMAIL_TO=samir@vrashows.com.br
```

Apenas console (dev/debug):
```env
NOTIFY_CHANNEL=console
```
(ou omitir — console é o default)

**CANAIS DISPONÍVEIS:**
| Canal | Velocidade | Setup | Custo |
|---|---|---|---|
| telegram | Instantâneo (<1s) | 1 token | Grátis |
| slack | Instantâneo | Webhook URL | Grátis (plano free) |
| email | 5-30s | RESEND_API_KEY | $0,001/email |
| whatsapp | 1-5s | CallMeBot API | Grátis (limite diário) |
| console | Síncrono | Nenhum | Grátis |

**FORMATO DO RELATÓRIO DE HANDOFF:**
```
═══════════════════════════════════
  🔔 HANDOFF — Lead qualificado
═══════════════════════════════════
Nome: [nome]
Empresa: [empresa]
Cargo: [cargo]
LinkedIn: [url]

Intenção: [HIGH/MEDIUM] | Variante: [A-E]
Poder de Decisão: [high/mid/low]
Score: [1-10]/10

Resposta original:
"[texto da resposta LinkedIn]"

Motivo do handoff:
[reason em ≤15 palavras]

Próxima ação sugerida:
[suggested_next_action]
═══════════════════════════════════
```

**COMO CRIAR UM BOT TELEGRAM:**
1. Abra `@BotFather` no Telegram
2. `/newbot` → escolha nome e username
3. Copie o token para `TELEGRAM_BOT_TOKEN`
4. Envie uma mensagem para o bot para ativar o chat
5. O `chat_id` está hardcoded (8135843555) — troque em `tools/telegram.ts` se necessário

**GARANTIAS DO SISTEMA:**
- Falha no canal NÃO para o pipeline (try/catch no notifyManager)
- Fallback automático para console se o canal configurado falhar
- Log estruturado Winston de toda tentativa de notificação
- O resultado da classificação é sempre retornado ao webhook caller, independente da notificação

**TESTANDO O HANDOFF:**
```typescript
import { notifyManager } from './agents/lead-classifier/notify.js';

await notifyManager(`
🔔 TESTE — Pipeline funcionando
Empresa: VRASHOWS (teste interno)
Intent: high | Score: 10/10
Próxima ação: Nenhuma — apenas validação de canal
`);
```
```

## Exemplo de uso

### Input
.env: `NOTIFY_CHANNEL=telegram`, `TELEGRAM_BOT_TOKEN=token_ativo`
Pipeline classifica resposta: Ricardo Torres / TOTVS / intent=high / handoff=true

### Output
**Telegram enviado em <1s:**
```
🔔 HANDOFF — VRAXIA SDR

Nome: Ricardo Torres
Empresa: TOTVS
Cargo: VP Marketing
LinkedIn: linkedin.com/in/ricardotorres-totvs

Intenção: HIGH | Variante: E
Poder de Decisão: high | Score: 10/10

Resposta:
"Interessante! Vocês atendem eventos de 2.000 pessoas?"

Próxima ação: LIGAR HOJE — evento em agosto, urgência real
```

**Log Winston gerado:**
```json
{ "level": "info", "message": "[notify] handoff enviado", "channel": "telegram" }
```

---
**Tags:** Técnico | Integração | Comercial, Handoff, Telegram, Notificação, Pipeline
