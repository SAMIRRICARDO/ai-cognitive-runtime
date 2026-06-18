---
name: webhook-de-respostas-linkedin-waalaxy-fastify
description: Configurar e operar o webhookServer do VRAXIA — um servidor Fastify que recebe eventos de resposta do LinkedIn via Waalaxy ou payload interno, classifica automaticamente cada resposta com o LeadClassifierAgent e notifica o closer quando o lead exige handoff humano.
tags: [webhook, waalaxy, fastify, linkedin, resposta, pipeline, automação, servidor, integração]
---

# Webhook de Respostas LinkedIn (Waalaxy + Fastify)

## Objetivo
Operar o `webhookServer.ts` do VRAXIA — um servidor Fastify que recebe eventos de resposta do LinkedIn em tempo real (via Waalaxy ou payload interno) — classifica automaticamente cada resposta com o `LeadClassifierAgent` e dispara o handoff para o closer quando o lead exige atenção humana. Elimina o monitoramento manual do inbox do LinkedIn.

## Quando usar
- Ao lançar uma campanha de DMs LinkedIn com a Waalaxy
- Para integrar qualquer automação LinkedIn que envia webhooks
- Para classificação automática de respostas sem intervenção manual
- Como alternativa ao `classifyReply.ts` manual em volume alto

## Como usar
1. Configure `TELEGRAM_BOT_TOKEN` e `NOTIFY_CHANNEL=telegram` no `.env`
2. Inicie o servidor: `tsx workers/webhookServer.ts`
3. Configure a Waalaxy para enviar eventos para `http://[seu-ip]:3001/webhook/waalaxy`
4. Cada resposta recebida é classificada automaticamente
5. Se `handoff: true` → notificação instantânea via Telegram/Slack/Email

## O Prompt
```
Você é o operador do pipeline de resposta LinkedIn do VRAXIA. O webhook elimina o gargalo humano de monitorar o inbox — qualquer resposta é processada em segundos.

**INICIANDO O SERVIDOR:**
```bash
tsx workers/webhookServer.ts
```
→ Porta padrão: 3001 (ou `PORT`/`WEBHOOK_PORT` no .env)

**ROTAS DISPONÍVEIS:**

GET /health
→ `{ "status": "ok", "agent": "VRAXIA SDR" }`

POST /webhook/linkedin
→ Payload interno (snake_case ou camelCase)
→ Classifica e retorna JSON com resultado

POST /webhook/waalaxy
→ Payload nativo Waalaxy (firstName, lastName, occupation, message)
→ Ignora eventos sem conteúdo de resposta
→ Classifica e dispara handoff se necessário

**MAPEAMENTO DE PAYLOAD (normalizePayload):**

| Campo Waalaxy | Campo Interno | Campo Legado |
|---|---|---|
| firstName + lastName | name | prospect_name |
| occupation | role | job_title |
| linkedInUrl | linkedinUrl | linkedin_url |
| message/lastMessage | reply | message_content |
| companyName | company | company |

**CONFIGURAÇÃO NO .ENV:**
```env
WEBHOOK_PORT=3001
NOTIFY_CHANNEL=telegram
TELEGRAM_BOT_TOKEN=seu_token_aqui
ANTHROPIC_API_KEY=sua_chave_aqui
```

**FLOW AUTOMÁTICO:**
```
[Waalaxy detecta resposta]
        ↓
POST /webhook/waalaxy
        ↓
normalizePayload() — padroniza campos
        ↓
processLinkedInReply() — chama LeadClassifierAgent (Haiku)
        ↓
[handoff: true] → notifyManager() → TELEGRAM/SLACK/EMAIL
[handoff: false] → registra log, sem escalada
        ↓
Resposta JSON ao webhook caller
```

**TESTANDO O WEBHOOK (curl):**
```bash
curl -X POST http://localhost:3001/webhook/waalaxy \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Ana",
    "lastName": "Lima",
    "occupation": "Gerente de Eventos",
    "companyName": "Claro Brasil",
    "linkedInUrl": "linkedin.com/in/analima",
    "message": "Olá! Sim, tenho interesse. Podemos agendar uma call?"
  }'
```

**RESPOSTA ESPERADA:**
```json
{
  "status": "ok",
  "result": {
    "variant": "E",
    "intent": "high",
    "decision_power": "mid",
    "score": 9,
    "handoff": true,
    "reason": "Pediu call explicitamente, interesse confirmado",
    "suggested_next_action": "Agendar call em 24h, enviar PDF com case similar"
  }
}
```

**EM PRODUÇÃO (Railway / VPS):**
Configure o processo para reiniciar automaticamente:
```json
// railway.json
{
  "build": { "builder": "nixpacks" },
  "deploy": { "startCommand": "tsx workers/webhookServer.ts" }
}
```
```

## Exemplo de uso

### Input
Waalaxy dispara evento: Ricardo Torres (VP Marketing, TOTVS) respondeu: "Oi, interessante! Vocês atendem eventos corporativos grandes? Temos uma convenção de 2.000 pessoas em agosto."

### Output
**Classification:**
```json
{ "variant": "E", "intent": "high", "decision_power": "high", "score": 10, "handoff": true, "reason": "VP pediu info + evento grande + urgência (agosto)", "suggested_next_action": "Ligar HOJE — oportunidade de evento imediato" }
```

**Telegram enviado:**
```
🔔 HANDOFF — VRAXIA SDR
Nome: Ricardo Torres
Empresa: TOTVS
Cargo: VP Marketing
Intent: HIGH | Variant: E | Score: 10/10
Próxima ação: Ligar HOJE — oportunidade de evento imediato
```

---
**Tags:** Técnico | Integração | Comercial, Webhook, Waalaxy, Fastify, LinkedIn
