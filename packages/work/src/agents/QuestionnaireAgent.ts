// packages/work/src/agents/QuestionnaireAgent.ts

import Anthropic from '@anthropic-ai/sdk';
import { QuestionnaireQuestion, QuestionnaireAnswer } from '../types/index.js';
import { VaultRetriever } from '../rag/retriever.js';
import { QuestionnaireLogger } from './QuestionnaireLogger.js';
import { QACache } from './cache.js';

// ─── SenseLayer — classificação CPU puro, zero custo de API ─────────────────

export type QuestionType =
  | 'FAST_YESNO'
  | 'FAST_NUMERIC'
  | 'FAST_SALARY'
  | 'TECH_STACK'
  | 'MOTIVATION'
  | 'COMPANY_SPECIFIC'
  | 'SOFT_SKILL'
  | 'PROJECT'
  | 'OPEN_ENDED';

// ─── Agent ───────────────────────────────────────────────────────────────────

export class QuestionnaireAgent {
  private client: Anthropic;
  private cache = new QACache();
  private logger?: QuestionnaireLogger;

  constructor(
    private retriever: VaultRetriever,
    apiKey?: string,
    logger?: QuestionnaireLogger,
  ) {
    this.client = new Anthropic({ apiKey });
    this.logger = logger;
    console.log(`[Questionnaire] QA Cache: ${this.cache.size} respostas carregadas`);
  }

  // Chamado pelo hunt antes de cada candidatura
  setJob(id: string, title: string, company: string, url = ''): void {
    this.logger?.setJob(id, title, company, url);
  }

  // Chamado pelo hunt após cada candidatura (grava o resumo .md + persiste cache)
  flushLog(): void {
    this.cache.flush();
    this.logger?.flush();
  }

  // ── SenseLayer: classifica a pergunta em CPU, sem API ──────────────────────

  classifyQuestion(question: QuestionnaireQuestion): QuestionType {
    const t = question.text.toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, ''); // remove acentos para matching robusto

    if (/autorizado|disponivel|imediato|sponsor|visto|cnh|brasileiro/.test(t))
      return 'FAST_YESNO';
    if (/expectativa salarial|salario|pretensao|remuneracao/.test(t))
      return 'FAST_SALARY';
    if (/anos de experiencia|quanto tempo|quantos anos/.test(t))
      return 'FAST_NUMERIC';
    if (/vraxia|human.?rag|sense|open.?source|publicacao|livro|projeto/.test(t))
      return 'PROJECT';
    if (/typescript|python|node\.?js|react|azure|docker|sql|kubernetes|redis|postgres/.test(t))
      return 'TECH_STACK';
    if (/por que|motivacao|objetivo|interesse|contribuir|escolheu|quer trabalhar/.test(t))
      return 'MOTIVATION';
    if (/nosso produto|nossa empresa|sobre nos|conhece a empresa/.test(t))
      return 'COMPANY_SPECIFIC';
    if (/ponto forte|ponto fraco|desafio|equipe|lideranca|5 anos|melhoria/.test(t))
      return 'SOFT_SKILL';
    return 'OPEN_ENDED';
  }

  // Retorna quais arquivos do vault priorizar para cada tipo
  getRAGScope(type: QuestionType): string[] {
    switch (type) {
      case 'TECH_STACK':       return ['stack-tecnico', 'experiencia', 'questionnaire-templates'];
      case 'MOTIVATION':       return ['linkedin-github', 'ricardo-profile', 'questionnaire-templates'];
      case 'PROJECT':          return ['linkedin-github', 'questionnaire-templates'];
      case 'SOFT_SKILL':       return ['questionnaire-templates', 'ricardo-profile'];
      case 'COMPANY_SPECIFIC': return ['companies'];
      default:                 return []; // OPEN_ENDED → corpus completo; FAST_* → não usa RAG
    }
  }

  // ── Resposta principal ─────────────────────────────────────────────────────

  async answer(question: QuestionnaireQuestion): Promise<QuestionnaireAnswer> {
    const qType = this.classifyQuestion(question);

    // Cache — evita chamadas repetidas para perguntas idênticas
    const cached = this.cache.get(question.text);
    if (cached !== undefined) {
      this.logger?.log(question.text, cached, [], qType);
      return { questionId: question.id, questionText: question.text, answer: cached };
    }

    // FAST path — resposta determinística sem API
    if (qType === 'FAST_YESNO' || qType === 'FAST_NUMERIC' || qType === 'FAST_SALARY') {
      const fast = this.tryFastAnswer(question) ?? '';
      this.cache.set(question.text, fast);
      this.logger?.log(question.text, fast, [], qType);
      console.log(`[Questionnaire/FAST/${qType}] "${question.text.slice(0, 60)}..." → "${fast}"`);
      return { questionId: question.id, questionText: question.text, answer: fast };
    }

    // RAG scoped — escopo determinado pelo tipo
    const scope  = this.getRAGScope(qType);
    const chunks = scope.length
      ? this.retriever.retrieveScoped(question.text, scope, 4)
      : this.retriever.retrieve(question.text, 4);

    const context = chunks
      .map(c => `[${c.source} > ${c.section}]\n${c.content}`)
      .join('\n\n---\n\n');

    const optionsText = question.options?.length
      ? `\nOpções disponíveis: ${question.options.join(', ')}`
      : '';

    const prompt = `
Você é Samir Ricardo Almeida, AI Architect com 15 anos de experiência técnica, founder da VRAXIA e VRASHOWS, autor do framework Human RAG.
Responda a pergunta de candidatura de forma profissional, concisa e verdadeira.

CONTEXTO DO PERFIL:
${context || 'AI Engineer, TypeScript/Node.js, 15 anos exp, SP, remoto preferencial'}

PERGUNTA (tipo: ${qType}): ${question.text}${optionsText}

INSTRUÇÕES:
- Se for seleção (select/radio), retorne EXATAMENTE uma das opções disponíveis
- Se for texto livre, responda em até 2 parágrafos curtos
- Tom: profissional, direto, sem exageros
- Idioma: mesmo idioma da pergunta
- NÃO inclua markdown, bullets ou aspas na resposta
`;

    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      });

      const answer = response.content[0].type === 'text'
        ? response.content[0].text.trim()
        : '';

      this.cache.set(question.text, answer);
      this.logger?.log(question.text, answer, chunks, qType);

      console.log(`[Questionnaire/${qType}] "${question.text.slice(0, 60)}..." → "${answer.slice(0, 80)}"`);
      return { questionId: question.id, questionText: question.text, answer };

    } catch (err) {
      console.error('[QuestionnaireAgent] Erro:', err);
      return { questionId: question.id, questionText: question.text, answer: '' };
    }
  }

  async answerAll(questions: QuestionnaireQuestion[]): Promise<QuestionnaireAnswer[]> {
    const answers: QuestionnaireAnswer[] = [];
    for (const q of questions) {
      answers.push(await this.answer(q));
    }
    return answers;
  }

  // ── Fast answers determinísticos ───────────────────────────────────────────

  private tryFastAnswer(q: QuestionnaireQuestion): string | null {
    const text = q.text.toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');

    if (q.type === 'number') {
      if (/anos.*experiencia/.test(text)) return '15';
      if (/salario|pretensao|remuneracao/.test(text)) return ''; // revisão manual
    }

    if (q.type === 'select' || q.type === 'radio') {
      const opts = q.options ?? [];
      if (/autorizado|trabalhar/.test(text))     return opts.find(o => /sim|yes/i.test(o)) ?? '';
      if (/disponivel|imediatamente/.test(text)) return opts.find(o => /sim|yes|immed/i.test(o)) ?? '';
      if (/sponsor|visto/.test(text))            return opts.find(o => /nao|no/i.test(o)) ?? '';
    }

    return null;
  }
}
