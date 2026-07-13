// linkedin-optimizer — analisa perfil e sugere melhorias baseadas no mercado (Sonnet)
import Anthropic from '@anthropic-ai/sdk';
import { AgentPlugin, AgentContext, AgentResult } from '../plugin-interface.js';

export const linkedinOptimizer: AgentPlugin = {
  id:              'linkedin-optimizer',
  name:            'LinkedIn Optimizer',
  description:     'Analisa seu perfil e sugere melhorias específicas baseadas nas keywords mais pedidas no mercado.',
  longDescription: 'Cruza o Digital Twin com as tendências do mercado e gera sugestões concretas: headline, about, skills a adicionar, posts a criar. Foca em aumentar o inbound de recrutadores.',
  version:         '1.0.0',
  author:          'VRAXIA',
  category:        'network',
  intents:         ['NETWORK', 'RESUME', 'CAREER'],
  price:           'free',
  iconEmoji:       '💼',
  tags:            ['linkedin', 'perfil', 'headline', 'inbound', 'recrutadores'],

  async execute(ctx: AgentContext): Promise<AgentResult> {
    if (!ctx.apiKey) {
      return { pluginId: 'linkedin-optimizer', reply: 'ANTHROPIC_API_KEY necessária para análise do LinkedIn.' };
    }
    const twin = ctx.twin;

    const client = new Anthropic({ apiKey: ctx.apiKey });
    const r = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Você é um especialista em personal branding para engenheiros de software no LinkedIn.
Analise o perfil e gere sugestões concretas e acionáveis.

PERFIL ATUAL:
- ${twin.identity.name} — ${twin.professional.currentTitle}
- ${twin.professional.yearsExp} anos de experiência, ${twin.professional.seniority}
- Stack: ${twin.professional.stack.join(', ')}
- Projeto destaque: ${twin.projects[0]?.name ?? 'N/A'} — ${twin.projects[0]?.description?.slice(0, 100) ?? ''}
- LinkedIn: ${twin.identity.linkedin}

Gere sugestões no formato JSON:
{
  "headlineSugerida": "<headline otimizada, máx 220 chars>",
  "aboutSugerido": "<primeiras 3 linhas do About — o gancho>",
  "skillsAdicionar": ["<skill 1>", "<skill 2>", "<skill 3>"],
  "postIdeia": "<ideia de post de alto engajamento para o perfil>",
  "quickWins": ["<ação imediata 1>", "<ação imediata 2>", "<ação imediata 3>"],
  "score": <0-100 quão otimizado está hoje>
}`,
      }],
    });

    const text   = r.content[0].type === 'text' ? r.content[0].text : '{}';
    const d      = JSON.parse(text.replace(/```json|```/g, '').trim());

    return {
      pluginId: 'linkedin-optimizer',
      reply: `💼 **LinkedIn Optimizer** — Score atual: ${d.score ?? '?'}/100

**Headline sugerida:**
"${d.headlineSugerida ?? '—'}"

**Gancho do About:**
"${d.aboutSugerido ?? '—'}"

**Skills a adicionar:** ${(d.skillsAdicionar ?? []).join(', ')}

**Ideia de post:** ${d.postIdeia ?? '—'}

**Quick wins:**
${(d.quickWins ?? []).map((w: string, i: number) => `${i + 1}. ${w}`).join('\n')}`,
      data: d,
      actions: [
        { label: '🌐 Abrir LinkedIn', action: `nav:${twin.identity.linkedin}` },
      ],
    };
  },
};
