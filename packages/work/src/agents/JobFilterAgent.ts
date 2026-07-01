// packages/work/src/agents/JobFilterAgent.ts

import Anthropic from '@anthropic-ai/sdk';
import { Job, JobScore, ApplyAction } from '../types/index.js';
import { VaultRetriever } from '../rag/retriever.js';
import { ModalityDetector } from '../engine/modality-detector.js';

const APPLY_THRESHOLD = 21;
const REVIEW_THRESHOLD = 15;

const SCORE_ZERO = { titleFit: 0, stackFit: 0, companyFit: 0, total: 0 };

export class JobFilterAgent {
  private client: Anthropic;
  private modality = new ModalityDetector();

  constructor(
    private retriever: VaultRetriever,
    apiKey?: string
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async score(job: Job): Promise<JobScore> {
    // ── Pré-filtro geográfico CPU-only (zero custo de API) ────────────────────
    const geo = this.modality.evaluate(job);
    if (!geo.isEligible) {
      return {
        ...SCORE_ZERO,
        jobId: job.id,
        dealBreaker: true,
        action: 'SKIP',
        reason: `Filtro geográfico: ${geo.reason}`,
      };
    }

    // Busca critérios do vault
    const criteriaContext = this.retriever.buildContext(
      `job criteria must-have deal-breaker ${job.title}`,
      4
    );

    const geoNote = geo.needsReview
      ? `\n⚠️  NOTA GEOGRÁFICA: ${geo.reason} — inclua isso na avaliação.`
      : '';

    const prompt = `
Você é um avaliador de vagas de emprego para Ricardo Almeida, AI Architect e founder da VRAXIA.
Avalie a vaga abaixo e retorne um JSON com o scoring.

CRITÉRIOS DO CANDIDATO:
${criteriaContext || 'TypeScript, Node.js, AI Engineering, B2B enterprise, remoto ou SP'}${geoNote}

VAGA:
Título: ${job.title}
Empresa: ${job.company}
Localização: ${job.location}
Descrição: ${job.description.slice(0, 1500)}

Retorne APENAS JSON válido, sem markdown:
{
  "titleFit": <0-10>,
  "stackFit": <0-10>,
  "companyFit": <0-10>,
  "dealBreaker": <true|false>,
  "reason": "<1 frase explicando o score>"
}
`;

    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

      const total = (parsed.titleFit ?? 0) + (parsed.stackFit ?? 0) + (parsed.companyFit ?? 0);
      const dealBreaker: boolean = parsed.dealBreaker ?? false;

      let action: ApplyAction = 'SKIP';
      if (!dealBreaker && total >= APPLY_THRESHOLD) action = 'APPLY';
      else if (!dealBreaker && total >= REVIEW_THRESHOLD) action = 'REVIEW';

      return {
        jobId: job.id,
        titleFit: parsed.titleFit ?? 0,
        stackFit: parsed.stackFit ?? 0,
        companyFit: parsed.companyFit ?? 0,
        dealBreaker,
        total,
        action,
        reason: parsed.reason ?? '',
      };
    } catch (err) {
      console.error('[JobFilterAgent] Erro no scoring:', err);
      return {
        jobId: job.id,
        titleFit: 0, stackFit: 0, companyFit: 0,
        dealBreaker: false,
        total: 0,
        action: 'REVIEW',
        reason: 'Erro no scoring — revisão manual necessária',
      };
    }
  }
}

