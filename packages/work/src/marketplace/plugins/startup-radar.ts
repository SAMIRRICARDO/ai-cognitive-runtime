// startup-radar — detecta sinais de startup e prioriza vagas de alto crescimento
import Anthropic from '@anthropic-ai/sdk';
import { AgentPlugin, AgentContext, AgentResult } from '../plugin-interface.js';

export const startupRadar: AgentPlugin = {
  id:              'startup-radar',
  name:            'Startup Radar',
  description:     'Detecta sinais de startup (funding, equity, crescimento) e prioriza vagas de alto potencial.',
  longDescription: 'Analisa a JD buscando menções de rodadas de investimento, equity, team size pequeno, crescimento acelerado e cultura de startup. Atribui um Startup Score e recomenda se vale priorizar.',
  version:         '1.0.0',
  author:          'VRAXIA',
  category:        'hunt',
  intents:         ['HUNT', 'EXPLAIN', 'ANALYTICS'],
  price:           'free',
  iconEmoji:       '🚀',
  tags:            ['startup', 'equity', 'growth', 'venture'],

  async execute(ctx: AgentContext): Promise<AgentResult> {
    const jd = ctx.jobDescription ?? ctx.input;
    if (!jd || jd.length < 50) {
      return { pluginId: 'startup-radar', reply: 'Forneça a descrição da vaga para eu analisar o perfil de startup.' };
    }

    const STARTUP_SIGNALS = [
      'série a', 'série b', 'series a', 'series b', 'seed', 'venture', 'vc-backed',
      'equity', 'stock options', 'vesting', 'esop', 'pre-ipo',
      'early stage', 'early-stage', 'scaleup', 'scale-up', 'hypergrowth',
      'y combinator', 'ycombinator', '500 startups', 'techstars',
    ];

    const jdLower = jd.toLowerCase();
    const found   = STARTUP_SIGNALS.filter(s => jdLower.includes(s));
    const cpuScore = Math.min(100, found.length * 15 + (jdLower.includes('startup') ? 20 : 0));

    // Se sinais suficientes, enriquece com IA
    if (ctx.apiKey && cpuScore > 0) {
      try {
        const client = new Anthropic({ apiKey: ctx.apiKey });
        const r = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          messages: [{
            role: 'user',
            content: `Analise esta vaga e retorne JSON:
{"startupScore": <0-100>, "signals": ["<sinal1>"], "equityMention": <true|false>, "fundingStage": "<seed|series-a|series-b|growth|desconhecido>", "verdict": "<Vale muito a pena|Vale a pena|Neutro|Evitar>", "reason": "<1 frase>"}

JD: ${jd.slice(0, 1500)}`,
          }],
        });
        const text   = r.content[0].type === 'text' ? r.content[0].text : '{}';
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        const score  = parsed.startupScore ?? cpuScore;
        return {
          pluginId: 'startup-radar',
          reply: `🚀 **Startup Radar** — Score: ${score}/100\n${parsed.verdict ?? 'Neutro'}: ${parsed.reason ?? ''}${parsed.equityMention ? '\n💎 Equity mencionado!' : ''}${parsed.fundingStage !== 'desconhecido' ? `\n📈 Estágio: ${parsed.fundingStage}` : ''}`,
          data:  parsed,
          actions: score >= 60 ? [{ label: '🚀 Candidatar agora', action: 'hunt:run:1' }] : [],
        };
      } catch { /* fall through to CPU result */ }
    }

    return {
      pluginId: 'startup-radar',
      reply: cpuScore > 0
        ? `🚀 **Startup Radar** — Score: ${cpuScore}/100\nSinais detectados: ${found.join(', ')}`
        : '🚀 **Startup Radar** — Nenhum sinal claro de startup nesta vaga.',
      data: { startupScore: cpuScore, signals: found },
    };
  },
};
