import type { Lead, AgentOutput } from '../../types/commercial.js';
import type { SessionMemory } from '../../memory/sessionMemory.js';

export async function runCRM(
  input: { lead: Lead; outreach?: Record<string, unknown> },
  memory: SessionMemory
): Promise<AgentOutput> {
  if (!input.lead) {
    return { success: false, data: {}, error: 'Lead não fornecido para CRM' };
  }

  const opportunity = {
    id: `opp_${Date.now()}`,
    lead_name: input.lead.name,
    company: input.lead.company,
    role: input.lead.role,
    score: input.lead.score ?? 0,
    status: 'new',
    outreach_ready: !!input.outreach,
    created_at: new Date().toISOString(),
    next_action: 'linkedin_contact',
    next_action_date: getNextBusinessDay()
  };

  console.log('[CRM] Oportunidade criada:', opportunity.id);

  return {
    success: true,
    data: {
      opportunity,
      lead: input.lead,
      outreach: input.outreach,
      pipeline_complete: true
    },
    next_action: 'notify_manager'
  };
}

function getNextBusinessDay(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  if (date.getDay() === 0) date.setDate(date.getDate() + 1);
  if (date.getDay() === 6) date.setDate(date.getDate() + 2);
  return date.toISOString().split('T')[0];
}
