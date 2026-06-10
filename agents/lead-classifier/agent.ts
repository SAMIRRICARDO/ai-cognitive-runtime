/**
 * LeadClassifierAgent — qualifica respostas de decisores no LinkedIn.
 *
 * Consome a resposta em texto de um lead e retorna:
 *   - variant  (A-E)  — perfil operacional da empresa
 *   - intent   (high/medium/low/none) — nível de interesse
 *   - handoff  (bool) — se deve escalar para humano
 *   - reason   — explicação em ≤ 15 palavras
 *   - suggested_next_action — próximo passo recomendado
 *
 * Design:
 *   - Sem ferramentas — classificação pura via LLM (single-turn)
 *   - Model: Haiku (fast, cheap, preciso em JSON estruturado)
 *   - Temperature: 0 (determinístico — saída JSON consistente)
 *   - Max tokens: 300 (JSON de retorno é pequeno)
 *   - Fallback automático se JSON inválido (variant B / intent medium)
 *   - Batch: classifica arrays de respostas com intervalo de segurança
 */

import { BaseAgent } from '../_base/agent.js';
import { logger } from '../../config/logger.js';
import { Models, ModelConfig, getMaxTokens } from '../../config/models.js';

import { CLASSIFIER_SYSTEM_PROMPT } from './constants.js';
import { parseClassification, FALLBACK_CLASSIFICATION } from './schemas.js';
import type { ClassificationInput, ClassificationResult, ClassifiedLead } from './types.js';

// ─── Agent ────────────────────────────────────────────────────────────────────

export class LeadClassifierAgent extends BaseAgent {

  /** Factory — prompt inlined via constants.ts, no async file read needed */
  static async create(): Promise<LeadClassifierAgent> {
    return new LeadClassifierAgent({
      name:        'lead-classifier',
      description: 'Qualifica respostas LinkedIn de decisores B2B — variant, intent, handoff',
      systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
      model:       Models.fast,            // Haiku — ideal for structured JSON
      maxTokens:   getMaxTokens(300),      // JSON output is small
      temperature: ModelConfig.temperature.deterministic,  // 0 — consistent output
      maxIterations: 1,                    // single-turn, no tool loops
      enableResponseCache: false,
    });
  }

  /**
   * Classifica uma única resposta de LinkedIn.
   * Retorna ClassificationResult com fallback automático em caso de erro.
   */
  async classify(input: ClassificationInput): Promise<ClassificationResult> {
    const t0 = Date.now();

    // Build user message — include optional context if provided
    const contextLine = [
      input.lead_name && `Lead: ${input.lead_name}`,
      input.company   && `Empresa: ${input.company}`,
    ].filter(Boolean).join(' | ');

    const userMessage = [
      contextLine && `[Contexto] ${contextLine}`,
      `[Resposta do LinkedIn]\n${input.linkedin_response.trim()}`,
    ].filter(Boolean).join('\n\n');

    let result: ClassificationResult;

    try {
      const agentResult = await this.run(userMessage);
      const parsed = parseClassification(agentResult.output);

      if (!parsed) {
        logger.warn('[lead-classifier] JSON inválido — aplicando fallback', {
          raw: agentResult.output.slice(0, 200),
        });
        result = FALLBACK_CLASSIFICATION;
      } else {
        result = parsed;
      }
    } catch (err) {
      logger.error('[lead-classifier] erro na classificação — aplicando fallback', {
        error: err instanceof Error ? err.message : String(err),
      });
      result = FALLBACK_CLASSIFICATION;
    }

    logger.info('[lead-classifier] classificado', {
      variant:  result.variant,
      intent:   result.intent,
      handoff:  result.handoff,
      latency:  Date.now() - t0,
      company:  input.company ?? '—',
    });

    return result;
  }

  /**
   * Classifica um lote de respostas em sequência.
   * Intervalo de 200ms entre chamadas para evitar rate limiting.
   */
  async classifyBatch(
    inputs: ClassificationInput[],
    onProgress?: (index: number, total: number, result: ClassifiedLead) => void
  ): Promise<ClassifiedLead[]> {
    const results: ClassifiedLead[] = [];

    for (let i = 0; i < inputs.length; i++) {
      const t0 = Date.now();
      const input  = inputs[i];
      const result = await this.classify(input);

      const classified: ClassifiedLead = {
        input,
        result,
        model:      Models.fast,
        latency_ms: Date.now() - t0,
        classified_at: new Date().toISOString(),
      };

      results.push(classified);
      onProgress?.(i + 1, inputs.length, classified);

      // Rate-limit guard between calls
      if (i < inputs.length - 1) await new Promise(r => setTimeout(r, 200));
    }

    return results;
  }

  /** Retorna apenas os leads com handoff: true (intent high ou variant E) */
  filterHandoff(classified: ClassifiedLead[]): ClassifiedLead[] {
    return classified.filter(c => c.result.handoff);
  }

  /** Resumo de um lote classificado */
  summarize(classified: ClassifiedLead[]): {
    total:    number;
    byIntent: Record<string, number>;
    byVariant: Record<string, number>;
    handoffs: number;
    avgLatencyMs: number;
  } {
    const byIntent:  Record<string, number> = {};
    const byVariant: Record<string, number> = {};
    let totalLatency = 0;
    let handoffs = 0;

    for (const c of classified) {
      byIntent[c.result.intent]   = (byIntent[c.result.intent]   ?? 0) + 1;
      byVariant[c.result.variant] = (byVariant[c.result.variant] ?? 0) + 1;
      totalLatency += c.latency_ms;
      if (c.result.handoff) handoffs++;
    }

    return {
      total:    classified.length,
      byIntent,
      byVariant,
      handoffs,
      avgLatencyMs: classified.length > 0 ? Math.round(totalLatency / classified.length) : 0,
    };
  }
}
