// packages/work/src/agents/ATSAgent.ts
// Analisa compatibilidade ATS do currículo vs Job Description

import Anthropic from '@anthropic-ai/sdk';
import { ATSResult } from '../types/index.js';
import { TwinStore } from '../twin/candidate-twin.js';
import { VaultRetriever } from '../rag/retriever.js';

export class ATSAgent {
  private client: Anthropic;

  constructor(
    private twinStore: TwinStore,
    private retriever: VaultRetriever,
    apiKey?: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async analyze(jobId: string, jobTitle: string, jobDescription: string): Promise<ATSResult> {
    const twin = this.twinStore.get();

    // Build CV context from vault + twin
    const cvContext = this.retriever.buildContext(`currículo experiência ${jobTitle}`, 6);
    const cvSummary = [
      `Cargo: ${twin.professional.currentTitle}`,
      `Experiência: ${twin.professional.yearsExp} anos`,
      `Stack: ${twin.professional.stack.join(', ')}`,
      `Skills: ${twin.professional.skills.join(', ')}`,
      `Projetos: ${twin.projects.map(p => p.name + ': ' + p.tech.join(', ')).join(' | ')}`,
      `Histórico: ${twin.history.map(h => `${h.role} @ ${h.company}`).join(' | ')}`,
    ].join('\n');

    const prompt = `
Você é um especialista em ATS (Applicant Tracking Systems) e otimização de currículos.
Analise a compatibilidade do currículo do candidato com a vaga.

CURRÍCULO DO CANDIDATO:
${cvSummary}

CONTEXTO ADICIONAL:
${cvContext || 'N/A'}

VAGA:
Título: ${jobTitle}
Descrição:
${jobDescription.slice(0, 3000)}

Retorne APENAS JSON válido:
{
  "atsScore": <0-100>,
  "presentKeywords": ["keyword1", "keyword2"],
  "missingKeywords": ["keyword1", "keyword2"],
  "improvementParagraph": "<parágrafo pronto para inserir no currículo, máx 3 linhas>",
  "recommendation": "<recomendação geral de 1-2 frases>"
}
`;

    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

      const result: ATSResult = {
        jobId,
        atsScore:             Math.min(100, Math.max(0, parsed.atsScore ?? 50)),
        missingKeywords:      parsed.missingKeywords ?? [],
        presentKeywords:      parsed.presentKeywords ?? [],
        improvementParagraph: parsed.improvementParagraph ?? '',
        recommendation:       parsed.recommendation ?? '',
      };

      // Persist ATS result in twin
      const twin = this.twinStore.get();
      if (!twin.learning) twin.learning = { certifications: [], studying: [], goals: [] };
      // Store as a note in twin goals for later retrieval
      const atsNote = `ATS ${jobId}: score=${result.atsScore}, missing=${result.missingKeywords.slice(0, 3).join(',')}`;
      if (!twin.learning.goals.some(g => g.startsWith(`ATS ${jobId}`))) {
        twin.learning.goals.unshift(atsNote);
        twin.learning.goals = twin.learning.goals.slice(0, 20); // keep last 20
        this.twinStore.save_twin(twin);
      }

      return result;
    } catch (err) {
      console.error('[ATSAgent] Erro:', err);
      return {
        jobId,
        atsScore: 0,
        missingKeywords: [],
        presentKeywords: [],
        improvementParagraph: '',
        recommendation: 'Erro na análise ATS — tente novamente',
      };
    }
  }
}
