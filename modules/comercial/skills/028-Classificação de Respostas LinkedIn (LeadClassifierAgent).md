---
name: classificacao-de-respostas-linkedin-lead-classifier-agent
description: Usar o LeadClassifierAgent do VRAXIA para classificar automaticamente cada resposta recebida no LinkedIn — determinando variante (A-E), intenção (high/medium/low/none), decision_power do cargo e se deve escalar para humano (handoff) — usando Haiku para processamento em batch com custo mínimo.
tags: [classifier, linkedin, resposta, intent, handoff, variant, decision-power, qualificação, haiku]
---

# Classificação de Respostas LinkedIn (LeadClassifierAgent)

## Objetivo
Processar automaticamente as respostas recebidas no LinkedIn usando o `LeadClassifierAgent` do VRAXIA — classificando cada resposta com variante de perfil (A-E), nível de intenção de compra (high/medium/low/none), poder de decisão do cargo e flag de handoff para escalada humana. Usa Haiku (modelo leve, temperatura 0) para máxima consistência com custo mínimo.

## Quando usar
- Quando prospects respondem às DMs do LinkedIn (após dispatcher)
- Para processar um lote de respostas acumuladas do inbox do LinkedIn
- Para decidir automaticamente quem escalar para o closer humano
- Para gerar relatório de qualidade das respostas de uma campanha

## Como usar
1. Copie a resposta do prospect do LinkedIn
2. Passe para o `LeadClassifierAgent.classify()` ou use o script `classifyReply.ts`
3. O agente retorna JSON estruturado com todos os campos de classificação
4. Se `handoff: true`, escala para o closer humano imediatamente
5. Use `classifyBatch()` para processar múltiplas respostas de uma vez

## O Prompt
```
Você é o qualificador de intenção do VRAXIA. Toda resposta de um prospect precisa ser classificada antes de qualquer ação — uma resposta classificada errada pode fazer o closer perder tempo com um "não" ou perder um "sim" que ficou na fila.

**USANDO VIA SCRIPT (CLI):**
```bash
tsx scripts/classifyReply.ts
```
→ Interativo: pede lead_name, company e linkedin_response

**USANDO VIA CÓDIGO:**
```typescript
import { LeadClassifierAgent } from './agents/lead-classifier/agent.js';

const classifier = await LeadClassifierAgent.create();

const result = await classifier.classify({
  linkedin_response: "Olá! Sim, temos interesse. Quando podemos agendar uma conversa?",
  lead_name: "Ana Lima",
  company: "Claro Brasil"
});

console.log(result);
// { variant: "E", intent: "high", decision_power: "mid", score: 9, handoff: true, reason: "...", suggested_next_action: "..." }
```

**VARIANTES (A-E):**
| Variante | Perfil da empresa |
|---|---|
| A | Equipe própria de eventos bem estruturada |
| B | Usa agência/parceiro externo (modelo terceirizado) |
| C | Modelo híbrido (parcial próprio + parcial terceiro) |
| D | Baixa frequência de eventos (1-2/ano) |
| E | Interesse direto imediato — pediu info ou reunião |

**INTENT (nível de intenção):**
| Intent | Significado |
|---|---|
| high | Pediu reunião, mais info, ou expressou dor clara |
| medium | Curiosidade leve, pediu material, interessado mas vago |
| low | Desviou do assunto, educadamente sem interesse |
| none | Completamente fora do ICP ou recusa direta |

**DECISION_POWER (cargo inferido):**
| Power | Cargos |
|---|---|
| high | C-Level, Diretor, VP, Head, Presidente (score 8-10) |
| mid | Gerente, Coordenador Sênior, Supervisor (score 5-7) |
| low | Analista, Assistente, Estagiário, Jr (score 1-4) |

**REGRA DE HANDOFF:**
- `handoff: true` quando: (intent=high AND power=high|mid) OU (intent=medium AND power=high)
- `handoff: false` quando: power=low (qualquer intent) OU intent=low|none

**BATCH PROCESSING:**
```typescript
const results = await classifier.classifyBatch(
  responses.map(r => ({ linkedin_response: r.text, lead_name: r.name, company: r.company })),
  (idx, total, classified) => {
    console.log(`[${idx}/${total}] ${classified.input.company} → ${classified.result.intent}`);
  }
);

const handoffs = classifier.filterHandoff(results);
const summary = classifier.summarize(results);
```

**SAÍDA COMPLETA:**
```json
{
  "variant": "E",
  "intent": "high",
  "decision_power": "high",
  "score": 9,
  "handoff": true,
  "reason": "Pediu reunião, cargo decisor, dor explícita",
  "suggested_next_action": "Agendar call de 30min, enviar proposta personalizada antes da reunião"
}
```
```

## Exemplo de uso

### Input
```
Resposta LinkedIn de: Ana Lima (Gerente de Eventos, Claro Brasil)
"Olá Samir! Interessante a abordagem. Trabalhamos com alguns parceiros hoje mas sempre avaliamos novas opções, especialmente para eventos de maior porte. Poderia me mandar mais detalhes sobre como funciona?"
```

### Output
```json
{
  "variant": "B",
  "intent": "medium",
  "decision_power": "mid",
  "score": 6,
  "handoff": false,
  "reason": "Usa parceiros externos, interesse moderado, pediu material",
  "suggested_next_action": "Enviar PDF de apresentação + case similar ao porte da Claro, follow-up em 3 dias"
}
```

**Ação automática gerada:**
- handoff: false → não escala para humano
- Agenda email-sender: enviar `vraxia-apresentacao.pdf` + case para Ana Lima
- Registra no outbound-log: status = "respondeu_warm"

---
**Tags:** Técnico | IA | Comercial, Classifier, LinkedIn, Handoff, Intent
