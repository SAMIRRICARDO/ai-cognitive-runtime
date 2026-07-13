// headhunter-script — gera scripts proativos para abordar headhunters e recrutadores
import Anthropic from '@anthropic-ai/sdk';
import { AgentPlugin, AgentContext, AgentResult } from '../plugin-interface.js';

export const headhunterScript: AgentPlugin = {
  id:              'headhunter-script',
  name:            'Headhunter Script',
  description:     'Gera scripts prontos para abordar headhunters, responder recrutadores e negociar convites.',
  longDescription: 'Cria mensagens personalizadas para abordagem proativa de headhunters no LinkedIn, respostas a mensagens de recrutadores e scripts de negociação de convites. Tom profissional sem parecer desesperado.',
  version:         '1.0.0',
  author:          'VRAXIA',
  category:        'network',
  intents:         ['NETWORK', 'SALARY'],
  price:           'free',
  iconEmoji:       '🎯',
  tags:            ['headhunter', 'recrutador', 'abordagem', 'mensagem', 'networking'],

  async execute(ctx: AgentContext): Promise<AgentResult> {
    if (!ctx.apiKey) {
      return { pluginId: 'headhunter-script', reply: 'ANTHROPIC_API_KEY necessária para gerar scripts.' };
    }
    const twin = ctx.twin;

    const client = new Anthropic({ apiKey: ctx.apiKey });
    const r = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `Você escreve mensagens de networking para engenheiros de software sênior.
Crie 3 scripts: abordagem proativa, resposta a recrutador, e follow-up.
Tom: confiante, profissional, não desesperado. Máximo 300 chars cada.

CANDIDATO:
${twin.identity.name} — ${twin.professional.currentTitle}
${twin.professional.yearsExp} anos, ${twin.professional.seniority}
Pretensão: R$ ${twin.financial.targetSalary.toLocaleString('pt-BR')}
Contexto: ${ctx.company ? `Interesse em ${ctx.company}` : 'Aberto a oportunidades sêniores'}

Retorne JSON:
{
  "abordagemProativa": "<mensagem>",
  "respostaRecrutador": "<mensagem>",
  "followUp7dias": "<mensagem>",
  "dicaDeTom": "<1 dica de como adaptar o tom>"
}`,
      }],
    });

    const text = r.content[0].type === 'text' ? r.content[0].text : '{}';
    const d    = JSON.parse(text.replace(/```json|```/g, '').trim());

    return {
      pluginId: 'headhunter-script',
      reply: `🎯 **Headhunter Scripts**

**1. Abordagem proativa:**
"${d.abordagemProativa ?? '—'}"

**2. Resposta a recrutador:**
"${d.respostaRecrutador ?? '—'}"

**3. Follow-up (7 dias sem resposta):**
"${d.followUp7dias ?? '—'}"

💡 _${d.dicaDeTom ?? ''}_`,
      data: d,
      actions: [{ label: '👥 Ir para Networking', action: 'nav:network' }],
    };
  },
};
