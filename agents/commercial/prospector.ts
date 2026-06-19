import Anthropic from '@anthropic-ai/sdk';
import type { SearchFilters, AgentOutput } from '../../types/commercial.js';
import type { SessionMemory } from '../../memory/sessionMemory.js';

const client = new Anthropic();

function parseJson(raw: string): Record<string, unknown> | null {
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(stripped); } catch { return null; }
}

export async function runProspector(
  input: { filters: SearchFilters },
  memory: SessionMemory
): Promise<AgentOutput> {
  const ragContext = memory.conversationSummary ?? '';

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: `
Você é o agente de prospecção do VRAXIA.
Gere leads fictícios plausíveis com base nos filtros fornecidos.
Retorne SOMENTE JSON puro, sem markdown, sem texto adicional.
Formato obrigatório:
{"leads":[{"id":"lead_001","name":"Nome Completo","company":"Empresa","role":"Cargo","linkedin_url":"https://linkedin.com/in/perfil"}]}
Máximo 3 leads.
${ragContext ? 'Contexto: ' + ragContext : ''}
    `.trim(),
    messages: [{
      role: 'user',
      content: `Filtros: ${JSON.stringify(input.filters)}`
    }]
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';
  const parsed = parseJson(raw);

  if (!parsed) {
    console.error('[Prospector] Falha no parse. Raw:', raw.slice(0, 200));
    return { success: false, data: {}, error: 'Erro no parsing dos leads' };
  }

  // Aceita tanto { leads: [] } quanto array direto
  const leads = Array.isArray(parsed) ? parsed : (parsed['leads'] as unknown[] ?? []);
  console.log(`[Prospector] ${leads.length} leads encontrados`);

  return { success: true, data: { leads }, next_action: 'enrich_lead' };
}
