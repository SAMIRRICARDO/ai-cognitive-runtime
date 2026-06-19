import Anthropic from '@anthropic-ai/sdk';
import type { Lead, AgentOutput } from '../../types/commercial.js';
import type { SessionMemory } from '../../memory/sessionMemory.js';

const client = new Anthropic();

const SCORING_SYSTEM = `
Você é o agente de qualificação comercial do VRAXIA para a VRASHOWS.

ICP VRASHOWS: empresas B2B de médio/grande porte que organizam ou participam de
eventos corporativos, feiras, convenções, lançamentos de produtos.

Se o lead já vier com scores calculados no campo "scores", valide-os e retorne.
Se não vier, calcule com base nos dados disponíveis.

Retorne SOMENTE JSON puro:
{
  "score": 0-100,
  "fit": "high|medium|low",
  "breakdown": {
    "fit_icp": 0-100,
    "urgencia": 0-100,
    "potencial_negocio": 0-100,
    "acessibilidade": 0-100
  },
  "qualificado": true|false,
  "proxima_acao": "string (ação concreta recomendada)",
  "justificativa": "string (1-2 linhas)"
}

REGRAS:
- qualificado = true se score >= 60
- proxima_acao deve ser específica: "enviar LinkedIn com ângulo X", "ligar na quinta de manhã", etc.
- Se lead.eventos.participa_eventos = true, fit_icp >= 70 automaticamente
`.trim();

export async function runScoring(
  input: { lead: Lead },
  memory: SessionMemory
): Promise<AgentOutput> {
  if (!input.lead) {
    return { success: false, data: {}, error: 'Lead não fornecido para scoring' };
  }

  // Se o enriquecimento já calculou scores, usar como base
  const leadData = input.lead as unknown as Record<string, unknown>;
  const existingScores = leadData['scores'] as Record<string, unknown> | undefined;
  if (existingScores && typeof existingScores['overall'] === 'number') {
    const overall = existingScores['overall'] as number;
    const fit = (existingScores['fit'] as string) ?? (overall >= 70 ? 'high' : overall >= 50 ? 'medium' : 'low');
    const qualificado = overall >= 60;

    console.log(`[Scoring] Usando scores do enriquecimento: ${overall} (${fit})`);
    const estrategia = leadData['estrategia_abordagem'] as Record<string, unknown> | undefined;
    return {
      success: true,
      data: {
        lead: { ...input.lead, score: overall, fit },
        score: overall,
        fit,
        score_breakdown: existingScores,
        score_reason: (existingScores['justificativa'] as string) ?? '',
        should_continue: qualificado,
        proxima_acao: estrategia?.['angulo_de_abertura']
      },
      next_action: qualificado ? 'generate_outreach' : 'skip_low_score'
    };
  }

  // Fallback: chamar Haiku para calcular
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: SCORING_SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(leadData) }]
  });

  const rawText = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';
  const raw = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    const parsed = JSON.parse(raw) as {
      score: number; fit: string; breakdown: Record<string, number>;
      qualificado: boolean; proxima_acao: string; justificativa: string;
    };

    return {
      success: true,
      data: {
        lead: { ...input.lead, score: parsed.score, fit: parsed.fit },
        score: parsed.score,
        fit: parsed.fit,
        score_breakdown: parsed.breakdown,
        score_reason: parsed.justificativa,
        proxima_acao: parsed.proxima_acao,
        should_continue: parsed.qualificado
      },
      next_action: parsed.qualificado ? 'generate_outreach' : 'skip_low_score'
    };
  } catch {
    return { success: false, data: {}, error: 'Erro no scoring' };
  }
}
