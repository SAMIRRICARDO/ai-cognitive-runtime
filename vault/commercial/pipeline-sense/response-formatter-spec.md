---
title: Response Formatter - Especificação
type: implementation-spec
module: response-formatter
status: implementation-ready
version: 1.0
created: 2026-06-18
tags: [vraxia, sense, formatter, ux, resposta, linguagem-natural]
depends_on: [commercial-sense-spec, execution-pipeline-spec]
---

# Response Formatter — Especificação

> O sistema nunca deve expor JSON bruto ao usuário.
> Todo output do pipeline deve ser convertido em linguagem
> natural, clara e formatada — como um assistente real responderia.

## 1. Princípio

O JSON é para máquinas. O usuário recebe linguagem humana.

ERRADO (JSON bruto):
{"lead": {"name": "Carlos"}, "composite_score": 71, "tier": "B"}

CERTO (linguagem natural formatada):
🎯 Lead encontrado — Tier B (Score 71/100)
👤 Carlos Alberto Mendes — Diretor de Marketing Digital na Telefônica Brasil
...

## 2. Formatos de Resposta por Tipo de Output

### 2.1 Lista de Leads (search_lead)

```
🔍 Encontrei [N] lead(s) para você:

1. **[Nome]** — [Cargo] na [Empresa]
   🔗 [linkedin_url]

2. **[Nome]** — [Cargo] na [Empresa]
   🔗 [linkedin_url]

Quer que eu analise a inteligência completa de algum deles?
Digite o número ou "todos" para analisar todos.
```

### 2.2 Lead Intelligence 360° (lead_intelligence_360)

```
🎯 **[Nome]** — [Cargo] | [Empresa]

📊 **Score: [score]/100 — Tier [tier]** | Probabilidade de fechamento: [win_probability]%
💰 Deal estimado: [estimated_deal_size]

✅ **Sinais positivos:**
• [green_flag_1]
• [green_flag_2]

⚠️ **Pontos de atenção:**
• [red_flag_1]

🎣 **Hook de abertura sugerido:**
"[opening_hook]"

💡 **Dor principal a abordar:** [key_pain_to_address]

📱 **Canal recomendado:** [best_approach]
▶️ **Ação recomendada:** [recommended_action]

---
Deseja que eu gere o outreach completo para [Nome]?
```

### 2.3 Outreach Gerado (generate_outreach)

```
✉️ **Outreach pronto para [Nome]:**

**LinkedIn:**
[linkedin_message]

**WhatsApp:**
[whatsapp_message]

**Email:**
Assunto: [email_subject]
[email_body]

**Script de Ligação:**
[cold_call_script]

---
Oportunidade criada no CRM. Próxima ação: [next_action] em [next_action_date]
```

### 2.4 Aguardando Confirmação (await_confirmation)

```
✅ **[passo executado com sucesso]**

Próximos passos disponíveis:
• [step_1]
• [step_2]

Quer que eu continue com [próximo passo]?
```

### 2.5 Pipeline Completo

```
🚀 **Pipeline completo para [Nome]!**

Executado: [steps_executed unidos por " → "]

📋 **Resumo:**
• Lead: [nome] | [cargo] | [empresa]
• Score: [score]/100 | Tier [tier]
• Deal estimado: [estimated_deal_size]
• Outreach: ✓ gerado
• CRM: ✓ oportunidade criada
• Próxima ação: [next_action] em [next_action_date]
```

## 3. Implementação do Formatter

```typescript
// agents/commercial/responseFormatter.ts
// Converte qualquer output do pipeline em linguagem natural.
// Custo zero — operação determinística, sem LLM.

export function formatResponse(
  output: Record<string, unknown>,
  stepsExecuted: string[]
): string {

  // Pipeline completo
  if (output.pipeline_complete) {
    return formatPipelineComplete(output, stepsExecuted);
  }

  // Aguardando confirmação
  if (output.awaiting_confirmation) {
    return formatAwaitingConfirmation(output, stepsExecuted);
  }

  // Lead Intelligence 360
  if (output.intelligence) {
    return formatLeadIntelligence(output.intelligence as any);
  }

  // Lista de leads
  if (output.leads) {
    return formatLeadList(output.leads as any[]);
  }

  // Outreach
  if (output.outreach) {
    return formatOutreach(output as any);
  }

  return '✅ Ação executada com sucesso.';
}

function formatLeadList(leads: any[]): string {
  const items = leads.map((l, i) =>
    `${i + 1}. **${l.name}** — ${l.role} na ${l.company}\n   🔗 ${l.linkedin_url ?? 'LinkedIn não disponível'}`
  ).join('\n\n');

  return `🔍 Encontrei ${leads.length} lead(s) para você:\n\n${items}\n\n` +
    `Quer que eu analise a inteligência completa de algum deles?\n` +
    `Digite o número ou "todos" para analisar todos.`;
}

function formatLeadIntelligence(intel: any): string {
  const lead = intel.lead;
  const tier = intel.tier ?? '?';
  const score = intel.composite_score ?? intel.score ?? 0;
  const tierEmoji: Record<string, string> = {
    A: '🔥', B: '🎯', C: '🌱', D: '⛔'
  };

  const greenFlags = (intel.green_flags ?? [])
    .map((f: string) => `• ${f}`).join('\n');
  const redFlags = (intel.red_flags ?? [])
    .map((f: string) => `• ${f}`).join('\n');

  return [
    `${tierEmoji[tier] ?? '🎯'} **${lead.name}** — ${lead.role} | ${lead.company}`,
    ``,
    `📊 **Score: ${score}/100 — Tier ${tier}** | Probabilidade de fechamento: ${intel.win_probability ?? '?'}%`,
    `💰 Deal estimado: ${intel.estimated_deal_size ?? 'a calcular'}`,
    ``,
    greenFlags ? `✅ **Sinais positivos:**\n${greenFlags}` : '',
    redFlags ? `\n⚠️ **Pontos de atenção:**\n${redFlags}` : '',
    ``,
    `🎣 **Hook de abertura sugerido:**`,
    `_"${intel.opening_hook ?? ''}"_`,
    ``,
    `💡 **Dor principal a abordar:** ${intel.key_pain_to_address ?? ''}`,
    intel.social_proof_to_use
      ? `🤝 **Prova social disponível:** ${intel.social_proof_to_use}` : '',
    ``,
    `📱 **Canal recomendado:** ${formatChannel(intel.best_approach)}`,
    `▶️ **Ação recomendada:** ${intel.recommended_action ?? ''}`,
    ``,
    `---`,
    `Deseja que eu gere o outreach completo para **${lead.name}**?`
  ].filter(Boolean).join('\n');
}

function formatOutreach(output: any): string {
  const lead = output.lead;
  const o = output.outreach;
  const opp = output.opportunity;

  return [
    `✉️ **Outreach pronto para ${lead?.name ?? 'o lead'}:**`,
    ``,
    `**LinkedIn:**`,
    o?.linkedin_message ?? '',
    ``,
    `**WhatsApp:**`,
    o?.whatsapp_message ?? '',
    ``,
    `**Email:**`,
    `Assunto: ${o?.email_subject ?? ''}`,
    o?.email_body ?? '',
    ``,
    `**Script de Ligação:**`,
    o?.cold_call_script ?? '',
    ``,
    `---`,
    opp
      ? `📁 Oportunidade criada no CRM. Próxima ação: **${opp.next_action}** em ${opp.next_action_date}`
      : ''
  ].filter(l => l !== undefined).join('\n');
}

function formatAwaitingConfirmation(
  output: Record<string, unknown>,
  stepsExecuted: string[]
): string {
  const lastStep = stepsExecuted[stepsExecuted.length - 1];
  const nextSteps = (output.next_steps_available as string[] ?? []);

  const stepLabel: Record<string, string> = {
    search_lead:            '🔍 Busca de lead concluída',
    lead_intelligence_360:  '🧠 Inteligência 360° gerada',
    enrich_lead:            '📋 Lead enriquecido',
    score_lead:             '📊 Lead pontuado',
    generate_outreach:      '✉️ Outreach gerado',
    create_crm_opportunity: '📁 Oportunidade criada no CRM'
  };

  const nextLabel: Record<string, string> = {
    lead_intelligence_360:  'Analisar inteligência completa do lead',
    generate_outreach:      'Gerar outreach personalizado',
    create_crm_opportunity: 'Criar oportunidade no CRM',
    enrich_lead:            'Enriquecer dados do lead',
    score_lead:             'Pontuar o lead'
  };

  const lines = [
    `${stepLabel[lastStep] ?? '✅ Passo concluído'}.`,
  ];

  if (nextSteps.length > 0) {
    lines.push('', 'Próximos passos disponíveis:');
    nextSteps.forEach(s => {
      lines.push(`• ${nextLabel[s] ?? s}`);
    });
    lines.push('', `Quer que eu continue?`);
  }

  return lines.join('\n');
}

function formatPipelineComplete(
  output: Record<string, unknown>,
  stepsExecuted: string[]
): string {
  const opp = output.opportunity as any;
  const lead = output.lead as any;
  const intel = (output.intelligence as any) ?? {};

  const stepLabels: Record<string, string> = {
    search_lead:            'Busca',
    lead_intelligence_360:  'Inteligência 360°',
    enrich_lead:            'Enriquecimento',
    score_lead:             'Pontuação',
    generate_outreach:      'Outreach',
    create_crm_opportunity: 'CRM'
  };

  const steps = stepsExecuted
    .map(s => stepLabels[s] ?? s)
    .join(' → ');

  return [
    `🚀 **Pipeline completo para ${lead?.name ?? 'o lead'}!**`,
    ``,
    `Executado: ${steps}`,
    ``,
    `📋 **Resumo:**`,
    `• Lead: **${lead?.name}** | ${lead?.role} | ${lead?.company}`,
    `• Score: **${lead?.score ?? intel?.composite_score ?? '?'}/100** | Tier ${intel?.tier ?? '?'}`,
    `• Deal estimado: ${intel?.estimated_deal_size ?? 'a calcular'}`,
    `• Outreach: ✓ gerado`,
    `• CRM: ✓ oportunidade criada`,
    opp
      ? `• Próxima ação: **${opp.next_action}** em ${opp.next_action_date}`
      : ''
  ].filter(Boolean).join('\n');
}

function formatChannel(channel: string): string {
  const labels: Record<string, string> = {
    linkedin:   '💼 LinkedIn',
    whatsapp:   '📱 WhatsApp',
    email:      '📧 Email',
    cold_call:  '📞 Ligação'
  };
  return labels[channel] ?? channel;
}
```

## 4. Onde plugar o Formatter

Em `agents/sense/senseOrchestrator.ts`, última linha antes do return:

```typescript
import { formatResponse } from '../commercial/responseFormatter';

// No final de runCommercialSense(), antes do return:
const formattedResponse = formatResponse(result.output, result.steps_executed);

return {
  response: result.output,           // JSON para máquinas (interno)
  formatted_response: formattedResponse, // Texto para o usuário (UI)
  updated_memory: updatedMemory,
  plan_executed: plan.steps.map(s => s.action)
};
```

## 5. Na rota do webhookServer.ts

```typescript
app.post('/sense/commercial/chat', async (request, reply) => {
  const body = request.body as any;
  const result = await runCommercialSense(body.message, memory);

  // Retornar o texto formatado para o frontend renderizar
  return reply.send({
    session_id: body.sessionId,
    message: result.formatted_response,  // ← isso vai para o usuário
    raw: result.response,                // ← isso fica disponível se precisar
    next_action: result.plan_executed
  });
});
```

## 6. Ver também

- [[commercial-sense-spec]]
- [[execution-pipeline-spec]]
- [[goal-inference-spec]]
