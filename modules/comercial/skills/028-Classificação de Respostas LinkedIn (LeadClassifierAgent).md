---
name: classificacao-de-respostas-linkedin-lead-classifier-agent
description: Classificar respostas recebidas no LinkedIn usando VRAXIA Sense (classify_linkedin_reply) — disponível diretamente no chat do Comercial AI. Detecta variante (A-E), intenção (high/medium/low/none), decision_power do cargo, score 1-10 e se deve escalar para humano (handoff). Envia alerta automático no Telegram quando handoff=true.
tags: [classifier, vraxia-sense, linkedin, resposta, intent, handoff, variant, decision-power, qualificação, haiku, telegram]
---

# Classificação de Respostas LinkedIn (VRAXIA Sense)

## Objetivo
Classificar cada resposta recebida no LinkedIn usando o motor **VRAXIA Sense** (`classify_linkedin_reply`) — disponível diretamente no chat do Comercial AI, sem precisar de script separado. Haiku (temperatura 0, 300 tokens) garante consistência máxima com custo mínimo. Se `handoff=true`, envia alerta automático no Telegram.

## Como usar no chat

Basta colar a resposta recebida no LinkedIn:

```
classifica essa resposta:
"Olá! Interessante a abordagem. Trabalhamos com parceiros mas avaliamos novas opções. Me manda mais detalhes?"
```

```
o que acha dessa resposta do LinkedIn? Ele respondeu:
"Boa tarde! Sim, temos interesse em conhecer. Pode agendar uma conversa?"
```

```
analisa essa mensagem que recebi:
"Obrigado pela mensagem. No momento não estamos buscando fornecedores."
```

O agente detecta automaticamente que é uma resposta para classificar e executa `classify_linkedin_reply`.

## Variantes (A-E)

| Variante | Perfil da empresa |
|---|---|
| A | Equipe própria de eventos bem estruturada |
| B | Usa agência/parceiro externo (modelo terceirizado) |
| C | Modelo híbrido (parcial próprio + parcial terceiro) |
| D | Baixa frequência de eventos (1-2/ano) |
| E | Interesse direto imediato — pediu info ou reunião |

## Intent (nível de intenção)

| Intent | Significado |
|---|---|
| high | Pediu reunião, mais info, ou expressou dor clara |
| medium | Curiosidade leve, pediu material, interessado mas vago |
| low | Desviou do assunto, educadamente sem interesse |
| none | Completamente fora do ICP ou recusa direta |

## Decision Power (cargo inferido)

| Power | Cargos | Score |
|---|---|---|
| high | C-Level, Diretor, VP, Head, Presidente | 8-10 |
| mid | Gerente, Coordenador Sênior, Supervisor | 5-7 |
| low | Analista, Assistente, Estagiário, Jr | 1-4 |

## Regra de Handoff

- `handoff: true` → (intent=high AND power=high|mid) OU (intent=medium AND power=high)
- `handoff: false` → power=low (qualquer intent) OU intent=low|none

**Quando handoff=true:** alerta automático enviado ao Telegram configurado em `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`.

## Output do classify_linkedin_reply

```json
{
  "variant": "E",
  "intent": "high",
  "decision_power": "high",
  "score": 9,
  "handoff": true,
  "reason": "Pediu reunião, cargo decisor, dor explícita",
  "suggested_next_action": "Agendar call de 30min, enviar proposta personalizada antes da reunião",
  "telegram_sent": true
}
```

## Exemplo completo

**Input no chat:**
```
classifica essa resposta do LinkedIn:
"Olá Samir! Interessante a abordagem. Trabalhamos com alguns parceiros hoje mas sempre avaliamos novas opções, especialmente para eventos de maior porte. Poderia me mandar mais detalhes sobre como funciona?"
```

**Output:**
```json
{
  "variant": "B",
  "intent": "medium",
  "decision_power": "mid",
  "score": 6,
  "handoff": false,
  "reason": "Usa parceiros externos, interesse moderado, pediu material",
  "suggested_next_action": "Enviar PDF de apresentação + case similar ao porte da empresa, follow-up em 3 dias",
  "telegram_sent": false
}
```

**Próximo passo sugerido:** enviar `vrashows_media_kit_optimized.pdf` + case relevante, agendar follow-up D+3.

## Usando via script (batch)

Para processar múltiplas respostas acumuladas:

```bash
tsx scripts/classifyReply.ts
```

→ Interativo: pede lead_name, company e linkedin_response

```typescript
import { LeadClassifierAgent } from './agents/lead-classifier/agent.js';
const classifier = await LeadClassifierAgent.create();
const results = await classifier.classifyBatch(responses);
const handoffs = classifier.filterHandoff(results);
```

---
**Tags:** Técnico | IA | Comercial, VRAXIA Sense, Classifier, LinkedIn, Handoff, Intent, Telegram
