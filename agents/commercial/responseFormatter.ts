// Converte qualquer output do pipeline em linguagem natural.
// Custo zero — operação determinística, sem LLM.

export function formatResponse(
  output: Record<string, unknown>,
  stepsExecuted: string[]
): string {

  if (output['pipeline_complete']) {
    return formatPipelineComplete(output, stepsExecuted);
  }

  // Leads têm prioridade sobre awaiting_confirmation
  if (output['leads']) {
    return formatLeadList(
      output['leads'] as Record<string, unknown>[],
      output['awaiting_confirmation'] as boolean | undefined
    );
  }

  if (output['intelligence']) {
    return formatLeadIntelligence(output['intelligence'] as Record<string, unknown>);
  }

  if (output['outreach']) {
    return formatOutreach(output);
  }

  if (output['awaiting_confirmation']) {
    return formatAwaitingConfirmation(output, stepsExecuted);
  }

  return '✅ Ação executada com sucesso.';
}

function formatLeadList(leads: Record<string, unknown>[], awaitingConfirmation?: boolean): string {
  const items = leads.map((l, i) =>
    `${i + 1}. **${l['name']}** — ${l['role']} na ${l['company']}\n   🔗 ${l['linkedin_url'] ?? 'LinkedIn não disponível'}`
  ).join('\n\n');

  const suffix = awaitingConfirmation
    ? `Quer que eu analise a inteligência completa de algum deles?\nDigite o número ou "todos" para analisar todos.`
    : `Quer que eu analise a inteligência completa de algum deles?`;

  return `🔍 Encontrei ${leads.length} lead(s) para você:\n\n${items}\n\n${suffix}`;
}

function formatLeadIntelligence(intel: Record<string, unknown>): string {
  const lead = intel['lead'] as Record<string, unknown>;
  const tier = (intel['tier'] as string) ?? '?';
  const score = (intel['composite_score'] as number) ?? (intel['score'] as number) ?? 0;
  const tierEmoji: Record<string, string> = { A: '🔥', B: '🎯', C: '🌱', D: '⛔' };

  const greenFlags = ((intel['green_flags'] as string[]) ?? [])
    .map(f => `• ${f}`).join('\n');
  const redFlags = ((intel['red_flags'] as string[]) ?? [])
    .map(f => `• ${f}`).join('\n');

  return [
    `${tierEmoji[tier] ?? '🎯'} **${lead['name']}** — ${lead['role']} | ${lead['company']}`,
    ``,
    `📊 **Score: ${score}/100 — Tier ${tier}** | Probabilidade de fechamento: ${intel['win_probability'] ?? '?'}%`,
    `💰 Deal estimado: ${intel['estimated_deal_size'] ?? 'a calcular'}`,
    ``,
    greenFlags ? `✅ **Sinais positivos:**\n${greenFlags}` : '',
    redFlags ? `\n⚠️ **Pontos de atenção:**\n${redFlags}` : '',
    ``,
    `🎣 **Hook de abertura sugerido:**`,
    `_"${intel['opening_hook'] ?? ''}"_`,
    ``,
    `💡 **Dor principal a abordar:** ${intel['key_pain_to_address'] ?? ''}`,
    intel['social_proof_to_use']
      ? `🤝 **Prova social disponível:** ${intel['social_proof_to_use']}` : '',
    ``,
    `📱 **Canal recomendado:** ${formatChannel(intel['best_approach'] as string)}`,
    `▶️ **Ação recomendada:** ${intel['recommended_action'] ?? ''}`,
    ``,
    `---`,
    `Deseja que eu gere o outreach completo para **${lead['name']}**?`
  ].filter(Boolean).join('\n');
}

function formatOutreach(output: Record<string, unknown>): string {
  const lead = output['lead'] as Record<string, unknown>;
  const o = output['outreach'] as Record<string, unknown>;
  const opp = output['opportunity'] as Record<string, unknown> | undefined;

  return [
    `✉️ **Outreach pronto para ${lead?.['name'] ?? 'o lead'}:**`,
    ``,
    `**LinkedIn:**`,
    (o?.['linkedin_message'] as string) ?? '',
    ``,
    `**WhatsApp:**`,
    (o?.['whatsapp_message'] as string) ?? '',
    ``,
    `**Email:**`,
    `Assunto: ${(o?.['email_subject'] as string) ?? ''}`,
    (o?.['email_body'] as string) ?? '',
    ``,
    `**Script de Ligação:**`,
    (o?.['cold_call_script'] as string) ?? '',
    ``,
    `---`,
    opp
      ? `📁 Oportunidade criada no CRM. Próxima ação: **${opp['next_action']}** em ${opp['next_action_date']}`
      : ''
  ].filter(l => l !== undefined).join('\n');
}

function formatAwaitingConfirmation(
  output: Record<string, unknown>,
  stepsExecuted: string[]
): string {
  const lastStep = stepsExecuted[stepsExecuted.length - 1];
  const nextSteps = (output['next_steps_available'] as string[]) ?? [];

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

  const lines = [`${stepLabel[lastStep] ?? '✅ Passo concluído'}.`];

  if (nextSteps.length > 0) {
    lines.push('', 'Próximos passos disponíveis:');
    nextSteps.forEach(s => lines.push(`• ${nextLabel[s] ?? s}`));
    lines.push('', `Quer que eu continue?`);
  }

  return lines.join('\n');
}

function formatPipelineComplete(
  output: Record<string, unknown>,
  stepsExecuted: string[]
): string {
  const opp = output['opportunity'] as Record<string, unknown> | undefined;
  const lead = output['lead'] as Record<string, unknown> | undefined;
  const intel = (output['intelligence'] as Record<string, unknown>) ?? {};

  const stepLabels: Record<string, string> = {
    search_lead:            'Busca',
    lead_intelligence_360:  'Inteligência 360°',
    enrich_lead:            'Enriquecimento',
    score_lead:             'Pontuação',
    generate_outreach:      'Outreach',
    create_crm_opportunity: 'CRM'
  };

  const steps = stepsExecuted.map(s => stepLabels[s] ?? s).join(' → ');

  return [
    `🚀 **Pipeline completo para ${lead?.['name'] ?? 'o lead'}!**`,
    ``,
    `Executado: ${steps}`,
    ``,
    `📋 **Resumo:**`,
    `• Lead: **${lead?.['name']}** | ${lead?.['role']} | ${lead?.['company']}`,
    `• Score: **${(lead?.['score'] as number) ?? (intel['composite_score'] as number) ?? '?'}/100** | Tier ${(intel['tier'] as string) ?? '?'}`,
    `• Deal estimado: ${(intel['estimated_deal_size'] as string) ?? 'a calcular'}`,
    `• Outreach: ✓ gerado`,
    `• CRM: ✓ oportunidade criada`,
    opp ? `• Próxima ação: **${opp['next_action']}** em ${opp['next_action_date']}` : ''
  ].filter(Boolean).join('\n');
}

function formatChannel(channel: string): string {
  const labels: Record<string, string> = {
    linkedin:  '💼 LinkedIn',
    whatsapp:  '📱 WhatsApp',
    email:     '📧 Email',
    cold_call: '📞 Ligação'
  };
  return labels[channel] ?? channel;
}
