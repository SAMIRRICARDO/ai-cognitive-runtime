export const SENSE_CONFIG = {
  commercial: {
    minMessageLength: 8,
    noiseWords: ['ok', 'obrigado', 'obrigada', 'blz', 'até mais', 'tchau', 'oi', 'olá', 'ola', 'tudo bem', 'bom dia', 'boa tarde', 'boa noite'],

    triageModel: 'claude-haiku-4-5-20251001',
    triageMaxTokens: 80,

    classificationModel: 'claude-haiku-4-5-20251001',
    classificationMaxTokens: 300,

    estimatedCostPerEventUSD: 0.0003,
  },
} as const;

export type SenseDomain = keyof typeof SENSE_CONFIG;
