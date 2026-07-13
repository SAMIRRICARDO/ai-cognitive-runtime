// packages/work/src/agents/SalaryAdvisor.ts
// Conselheiro salarial: faixa de mercado + script de negociação (Sonnet)

import Anthropic from '@anthropic-ai/sdk';
import { SalaryAdvice } from '../types/index.js';
import { TwinStore } from '../twin/candidate-twin.js';

export class SalaryAdvisor {
  private client: Anthropic;

  constructor(
    private twinStore: TwinStore,
    apiKey?: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async advise(jobTitle: string, company: string, jobDescription: string, jobId?: string): Promise<SalaryAdvice> {
    const twin = this.twinStore.get();

    const prompt = `Você é um especialista em remuneração do mercado tech brasileiro.
Analise a vaga e o perfil do candidato e forneça um conselho salarial completo.

CANDIDATO:
- ${twin.identity.name} — ${twin.professional.currentTitle}
- ${twin.professional.yearsExp} anos de experiência, ${twin.professional.seniority}
- Stack: ${twin.professional.stack.join(', ')}
- Pretensão atual: R$ ${twin.financial.targetSalary.toLocaleString('pt-BR')} (${twin.financial.currency})
- Salário atual: R$ ${twin.financial.currentSalary.toLocaleString('pt-BR')}
- Negociável: ${twin.financial.negotiable ? 'Sim' : 'Não'}

VAGA:
Empresa: ${company}
Título: ${jobTitle}
Descrição: ${jobDescription.slice(0, 2000)}

Retorne APENAS JSON válido:
{
  "recommendedSalary": <número em BRL>,
  "negotiationRange": { "min": <número>, "max": <número> },
  "marketPercentile": <0-100 onde o candidato se encaixa>,
  "negotiationTips": ["<dica 1>", "<dica 2>", "<dica 3>"],
  "bestMomentToNegotiate": "<quando negociar — antes/depois/durante>",
  "scriptSuggestion": "<frase pronta para pedir o salário ideal>",
  "currency": "BRL"
}`;

    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

      return {
        jobId,
        recommendedSalary: parsed.recommendedSalary ?? twin.financial.targetSalary,
        negotiationRange: {
          min: parsed.negotiationRange?.min ?? twin.financial.targetSalary * 0.9,
          max: parsed.negotiationRange?.max ?? twin.financial.targetSalary * 1.2,
        },
        marketPercentile: Math.min(100, Math.max(0, parsed.marketPercentile ?? 50)),
        negotiationTips: parsed.negotiationTips ?? [],
        bestMomentToNegotiate: parsed.bestMomentToNegotiate ?? '',
        scriptSuggestion: parsed.scriptSuggestion ?? '',
        currency: 'BRL',
      };
    } catch (err) {
      console.error('[SalaryAdvisor] Erro:', err);
      return {
        jobId,
        recommendedSalary: twin.financial.targetSalary,
        negotiationRange: {
          min: Math.round(twin.financial.targetSalary * 0.85),
          max: Math.round(twin.financial.targetSalary * 1.25),
        },
        marketPercentile: 50,
        negotiationTips: ['Pesquise a faixa no Glassdoor e LinkedIn Salary antes da conversa.'],
        bestMomentToNegotiate: 'Após a oferta formal — nunca antes.',
        scriptSuggestion: `"Com base na minha experiência de ${twin.professional.yearsExp} anos e no mercado atual, minha pretensão é R$ ${twin.financial.targetSalary.toLocaleString('pt-BR')}."`,
        currency: 'BRL',
      };
    }
  }
}
