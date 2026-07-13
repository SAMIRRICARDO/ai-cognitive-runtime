// packages/work/src/agents/MatchAgent.ts
// 6-dimension job scoring — replaces JobFilterAgent (score 0–100)

import Anthropic from '@anthropic-ai/sdk';
import { Job, MatchScore, MatchDimensions, ApplyAction } from '../types/index.js';
import { VaultRetriever } from '../rag/retriever.js';
import { ModalityDetector } from '../engine/modality-detector.js';
import { TwinStore } from '../twin/candidate-twin.js';

const APPLY_THRESHOLD  = 75;
const REVIEW_THRESHOLD = 50;

export class MatchAgent {
  private client: Anthropic;
  private modality = new ModalityDetector();

  constructor(
    private retriever: VaultRetriever,
    private twinStore: TwinStore,
    apiKey?: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async score(job: Job): Promise<MatchScore> {
    // CPU pre-filter — zero API cost
    const geo = this.modality.evaluate(job);
    if (!geo.isEligible) {
      return this.skipScore(job.id, `Filtro geográfico: ${geo.reason}`);
    }

    const twin = this.twinStore.get();

    const context = this.retriever.buildContext(
      `skills stack experience ${job.title} ${job.company}`, 4,
    );

    const prompt = `
Você é um avaliador especializado de vagas para candidatos de tecnologia sênior.
Avalie a compatibilidade da vaga com o perfil do candidato em 6 dimensões.

PERFIL DO CANDIDATO:
- Nome: ${twin.identity.name}
- Cargo atual: ${twin.professional.currentTitle}
- Experiência: ${twin.professional.yearsExp} anos
- Senioridade: ${twin.professional.seniority}
- Stack: ${twin.professional.stack.join(', ')}
- Skills: ${twin.professional.skills.join(', ')}
- Salário alvo: R$ ${twin.financial.targetSalary.toLocaleString('pt-BR')}
- Modalidade: ${twin.preferences.remote ? 'Remoto/híbrido preferencial' : 'Presencial OK'}
- Localização: ${twin.preferences.locations.join(', ')}

CONTEXTO ADICIONAL DO VAULT:
${context || 'N/A'}

VAGA:
Título: ${job.title}
Empresa: ${job.company}
Localização: ${job.location}
Descrição: ${job.description.slice(0, 2000)}

Retorne SOMENTE o JSON abaixo, sem texto adicional:
{"matchTecnico":<0-35>,"matchSalarial":<0-20>,"matchSenioridade":<0-20>,"matchCultural":<0-10>,"matchIdioma":<0-10>,"matchLocalizacao":<0-5>,"dealBreaker":<true|false>,"reason":"<1 frase>","reasonApply":<"frase" ou null>,"reasonFilter":<"frase" ou null>}

Regras:
- matchSalarial=15 se faixa não informada
- dealBreaker=true APENAS para estágio/júnior/trainee ou localização proibida
- reasonApply: preencha se score>=75, caso contrário null
- reasonFilter: preencha se score<50, caso contrário null
`;

    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
      // Extrai o objeto JSON mesmo quando o LLM adiciona texto antes/depois ou fences de código.
      // text.match encontra o primeiro {...} completo incluindo objetos aninhados.
      const raw = text.replace(/```json|```/g, '').trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : '{}');

      const dims: MatchDimensions = {
        matchTecnico:     Math.min(35, Math.max(0, parsed.matchTecnico     ?? 0)),
        matchSalarial:    Math.min(20, Math.max(0, parsed.matchSalarial    ?? 15)),
        matchSenioridade: Math.min(20, Math.max(0, parsed.matchSenioridade ?? 0)),
        matchCultural:    Math.min(10, Math.max(0, parsed.matchCultural    ?? 5)),
        matchIdioma:      Math.min(10, Math.max(0, parsed.matchIdioma      ?? 7)),
        matchLocalizacao: Math.min(5,  Math.max(0, parsed.matchLocalizacao ?? 3)),
      };

      const total = Object.values(dims).reduce((a, b) => a + b, 0);
      const dealBreaker: boolean = parsed.dealBreaker ?? false;

      let action: ApplyAction = 'SKIP';
      if (!dealBreaker && total >= APPLY_THRESHOLD)  action = 'APPLY';
      else if (!dealBreaker && total >= REVIEW_THRESHOLD) action = 'REVIEW';

      return {
        jobId: job.id,
        total,
        dimensions: dims,
        dealBreaker,
        action,
        reason:       parsed.reason ?? '',
        reasonApply:  parsed.reasonApply ?? undefined,
        reasonFilter: parsed.reasonFilter ?? undefined,
      };
    } catch (err) {
      console.error('[MatchAgent] Erro no scoring:', err);
      return this.skipScore(job.id, 'Erro no scoring — revisão manual necessária');
    }
  }

  private skipScore(jobId: string, reason: string): MatchScore {
    return {
      jobId,
      total: 0,
      dimensions: {
        matchTecnico: 0, matchSalarial: 0, matchSenioridade: 0,
        matchCultural: 0, matchIdioma: 0, matchLocalizacao: 0,
      },
      dealBreaker: true,
      action: 'SKIP',
      reason,
      reasonFilter: reason,
    };
  }
}
