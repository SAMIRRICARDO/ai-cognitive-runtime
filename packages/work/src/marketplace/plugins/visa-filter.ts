// visa-filter — detecta vagas que patrocinam visto de trabalho (útil para emigração)
import { AgentPlugin, AgentContext, AgentResult } from '../plugin-interface.js';

export const visaFilter: AgentPlugin = {
  id:              'visa-filter',
  name:            'Visa Filter',
  description:     'Detecta vagas que patrocinam visto de trabalho — ideal para quem planeja trabalhar no exterior.',
  longDescription: 'Analisa a JD buscando menções explícitas de patrocínio de visto (visa sponsorship) para EUA, Europa, Canadá, Austrália e outros destinos. Extrai requisitos de elegibilidade e país alvo.',
  version:         '1.0.0',
  author:          'VRAXIA',
  category:        'hunt',
  intents:         ['HUNT', 'CAREER'],
  price:           'free',
  iconEmoji:       '🛂',
  tags:            ['visto', 'visa', 'emigração', 'exterior', 'relocation', 'sponsorship'],

  async execute(ctx: AgentContext): Promise<AgentResult> {
    const jd = ctx.jobDescription ?? ctx.input;
    if (!jd || jd.length < 30) {
      return { pluginId: 'visa-filter', reply: 'Forneça a descrição da vaga para verificar patrocínio de visto.' };
    }

    const jdLower = jd.toLowerCase();

    const VISA_POSITIVE = [
      'visa sponsorship', 'we sponsor', 'sponsorship available', 'work authorization',
      'h-1b', 'h1b', 'tier 2', 'skilled worker visa', 'relocation package',
      'relocation assistance', 'relocate', 'work permit',
    ];
    const VISA_NEGATIVE = [
      'no visa', 'not sponsor', 'cannot sponsor', 'no sponsorship', 'must be authorized',
      'must already be authorized', 'citizens only', 'residents only',
    ];

    const COUNTRY_MAP: Record<string, string[]> = {
      '🇺🇸 EUA':      ['united states', 'usa', 'us-based', 'new york', 'san francisco', 'austin', 'seattle'],
      '🇬🇧 UK':       ['united kingdom', 'london', 'manchester', 'uk-based', 'tier 2'],
      '🇨🇦 Canadá':   ['canada', 'toronto', 'vancouver', 'montreal', 'canadian'],
      '🇩🇪 Alemanha': ['germany', 'berlin', 'munich', 'germany-based'],
      '🇳🇱 Holanda':  ['netherlands', 'amsterdam', 'dutch'],
      '🇦🇺 Austrália':['australia', 'sydney', 'melbourne', 'australian'],
      '🇵🇹 Portugal': ['portugal', 'lisbon', 'porto', 'portuguese'],
    };

    const positiveHits = VISA_POSITIVE.filter(s => jdLower.includes(s));
    const negativeHits = VISA_NEGATIVE.filter(s => jdLower.includes(s));
    const countries    = Object.entries(COUNTRY_MAP)
      .filter(([, kws]) => kws.some(kw => jdLower.includes(kw)))
      .map(([flag]) => flag);

    let verdict: string;
    let emoji: string;

    if (negativeHits.length > 0) {
      verdict = '⛔ **NÃO patrocina visto**';
      emoji   = '🔴';
    } else if (positiveHits.length > 0) {
      verdict = '✅ **Patrocina visto!**';
      emoji   = '🟢';
    } else {
      verdict = '⚠️ **Não mencionado** — verifique com o RH';
      emoji   = '🟡';
    }

    const countryText = countries.length ? `\nPaíses detectados: ${countries.join(', ')}` : '';
    const posText     = positiveHits.length ? `\nSinais positivos: _${positiveHits.join(', ')}_` : '';
    const negText     = negativeHits.length ? `\nSinais negativos: _${negativeHits.join(', ')}_` : '';

    return {
      pluginId: 'visa-filter',
      reply: `🛂 **Visa Filter** — ${emoji} ${verdict}${countryText}${posText}${negText}`,
      data: { positiveHits, negativeHits, countries, sponsored: negativeHits.length === 0 && positiveHits.length > 0 },
      actions: positiveHits.length > 0
        ? [{ label: '📋 Ver detalhes da vaga', action: 'nav:table' }]
        : [],
    };
  },
};
