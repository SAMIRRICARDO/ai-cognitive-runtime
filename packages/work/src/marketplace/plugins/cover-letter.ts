// cover-letter — gera carta de apresentação personalizada em PT-BR (Sonnet)
import Anthropic from '@anthropic-ai/sdk';
import { AgentPlugin, AgentContext, AgentResult } from '../plugin-interface.js';

export const coverLetter: AgentPlugin = {
  id:              'cover-letter-br',
  name:            'Cover Letter BR',
  description:     'Gera carta de apresentação personalizada em português para cada vaga.',
  longDescription: 'Combina o perfil do Digital Twin com a JD e produz uma carta profissional, específica e convincente em PT-BR. Evita clichês e foca em conexões reais entre sua experiência e a vaga.',
  version:         '1.0.0',
  author:          'VRAXIA',
  category:        'resume',
  intents:         ['RESUME', 'HUNT'],
  price:           'free',
  iconEmoji:       '✉️',
  tags:            ['carta', 'cover letter', 'apresentação', 'candidatura'],

  async execute(ctx: AgentContext): Promise<AgentResult> {
    if (!ctx.apiKey) {
      return { pluginId: 'cover-letter-br', reply: 'ANTHROPIC_API_KEY necessária para gerar carta.' };
    }
    const twin = ctx.twin;
    const jd   = ctx.jobDescription ?? ctx.input;

    const client = new Anthropic({ apiKey: ctx.apiKey });
    const r = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: `Você escreve cartas de apresentação para engenheiros de software sênior no mercado brasileiro.
Crie uma carta personalizada, profissional e sem clichês. Máximo 4 parágrafos.

CANDIDATO:
${twin.identity.name} — ${twin.professional.currentTitle}
${twin.professional.yearsExp} anos de experiência
Stack: ${twin.professional.stack.join(', ')}
Projeto destaque: ${twin.projects[0]?.name ?? 'N/A'} — ${twin.projects[0]?.description?.slice(0, 100) ?? ''}
Motivações: ${twin.behavioral.motivations.join(', ')}

VAGA:
Empresa: ${ctx.company ?? 'N/A'}
Cargo: ${ctx.jobTitle ?? 'N/A'}
Descrição: ${jd.slice(0, 1500)}

Retorne APENAS o texto da carta, sem saudação genérica nem assinatura.`,
      }],
    });

    const letter = r.content[0].type === 'text' ? r.content[0].text.trim() : '';
    return {
      pluginId: 'cover-letter-br',
      reply: `✉️ **Carta de Apresentação** — ${ctx.company ?? 'vaga'}\n\n${letter}`,
      data: { letter, company: ctx.company, jobTitle: ctx.jobTitle },
      actions: [{ label: '📋 Copiar carta', action: 'copy:cover-letter' }],
    };
  },
};
