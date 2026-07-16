// packages/work/src/agents/QuestionnaireAgent.ts
// Hierarquia: hard-rules → FAQ → interview-answers → RAG → Haiku

import Anthropic from '@anthropic-ai/sdk';
import { QuestionnaireQuestion, QuestionnaireAnswer } from '../types/index.js';
import { VaultRetriever } from '../rag/retriever.js';
import { CandidateKBRetriever } from '../rag/candidate-kb-retriever.js';
import { CandidateProfileLoader } from '../rag/candidate-profile-loader.js';
import { DecisionLayer, QuestionIntent } from '../rag/candidate-profile-types.js';
import type { DecisionTrace } from '../rag/candidate-profile-types.js';
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
  | 'OPEN_ENDED'
  | 'ATS_FIELD';

const DEFAULT_SYSTEM_PROMPT = `Você é Samir Ricardo Almeida, AI Architect com 15 anos de experiência, founder da VRAXIA e VRASHOWS.
Responda perguntas de candidatura de forma profissional, concisa e verdadeira, sempre em primeira pessoa.
Nunca use markdown, bullets ou aspas. Idioma: mesmo da pergunta.`;

// ─── Agent ───────────────────────────────────────────────────────────────────

export class QuestionnaireAgent {
  private client: Anthropic;
  private cache = new QACache();
  private logger?: QuestionnaireLogger;
  private facts: Record<string, string> = {};
  private kb?: CandidateKBRetriever;
  private profileLoader?: CandidateProfileLoader;

  constructor(
    private retriever: VaultRetriever,
    apiKey?: string,
    logger?: QuestionnaireLogger,
  ) {
    this.client = new Anthropic({ apiKey });
    this.logger = logger;
    console.log(`[Questionnaire] QA Cache: ${this.cache.size} respostas carregadas`);
  }

  // Registra a Candidate Knowledge Base (substitui vault RAG)
  useKB(kb: CandidateKBRetriever): void {
    this.kb = kb;
    console.log('[Questionnaire] CandidateKB ativado — 5 camadas de resolução');
  }

  // Registra o CandidateProfileLoader (SSoT — Camada 0, acima do cache)
  useProfileLoader(loader: CandidateProfileLoader): void {
    this.profileLoader = loader;
    this.cache.setProfileVersion(loader.getVersion());
    console.log(`[Questionnaire] CandidateProfile v${loader.getVersion()} → SSoT ativo`);
  }

  // Injeta dados do twin como facts determinísticos
  setFact(key: string, value: string): void {
    if (value) this.facts[key] = value;
  }

  // Chamado pelo hunt antes de cada candidatura
  setJob(id: string, title: string, company: string, url = ''): void {
    this.logger?.setJob(id, title, company, url);
  }

  setAtsSource(source: string): void {
    this.logger?.setAtsSource(source);
  }

  logField(label: string, value: string, questionType: QuestionType = 'ATS_FIELD'): void {
    this.logger?.logField(label, value, questionType);
  }

  flushLog(): void {
    this.cache.flush();
    this.logger?.flush();
  }

  // ── SenseLayer: classifica a pergunta em CPU, sem API ──────────────────────

  classifyQuestion(question: QuestionnaireQuestion): QuestionType {
    const t = question.text.toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');

    // ── FAST_FIXED: campos determinísticos de identidade/formação ─────────────
    if (/\bcpf\b|cadastro.*pessoa.*fisica|cpf.*candidato/.test(t))
      return 'FAST_YESNO';
    if (/parentesco|grau.*parente|parente.*funcion|funcion.*parente|indica.*parente|indique.*parente|nome.*parente/.test(t))
      return 'FAST_YESNO';
    if (/^escola\s*\*?\s*$/i.test(question.text.trim()))
      return 'FAST_YESNO';
    if (/escolaridade|grau.*instru|nivel.*escol/.test(t))
      return 'FAST_YESNO';
    if (/^disciplina\s*\*?\s*$/i.test(question.text.trim()))
      return 'FAST_YESNO';

    // ── FAST_YESNO: binário determinístico ────────────────────────────────────
    if (/autorizado|disponivel|imediato|sponsor|visto|brasileiro/.test(t))
      return 'FAST_YESNO';
    if (/pcd|deficiencia|necessidade especial|pessoa com defici/.test(t))
      return 'FAST_YESNO';
    if (/relocar|relocacao|mudar.*cidade|mudanca.*cidade|disponib.*mudar|outra cidade/.test(t))
      return 'FAST_YESNO';
    if (/viagem|viajar|disponib.*viag|viag.*disponib/.test(t))
      return 'FAST_YESNO';
    if (/cnh|carteira.*habilitacao|habilitacao/.test(t))
      return 'FAST_YESNO';
    if (/equipamento.*proprio|notebook.*proprio|computador.*proprio|tem notebook|possui notebook/.test(t))
      return 'FAST_YESNO';
    if (/(tem|possui) (experiencia|conhecimento)|ja (trabalhou|usou|utilizou) com|conhece (o |a |alguma )?/.test(t) &&
        /typescript|javascript|node|react|python|sql|azure|docker|kubernetes|redis|postgres|aws|gcp|cloud|git/.test(t))
      return 'FAST_YESNO';
    if (/orientacao sexual|sexualidade|voce e hetero|voce e homossexual/.test(t))
      return 'FAST_YESNO';
    if (/identidade de genero|voce e cis|cisgenero/.test(t))
      return 'FAST_YESNO';
    if (/genero|sexo/.test(t))
      return 'FAST_YESNO';
    if (/raca|etnia|cor.*pele|autodeclar/.test(t))
      return 'FAST_YESNO';

    // ── candidateFacts: delegado ao CandidateProfileLoader (SSoT) ────────────
    if (this.profileLoader?.isBinaryQuestion(t))
      return 'FAST_YESNO';

    // ── FAST_SALARY ───────────────────────────────────────────────────────────
    if (/salari(o|al)|pretensao|remuneracao/.test(t))
      return 'FAST_SALARY';

    // ── FAST_NUMERIC: valores determinísticos ─────────────────────────────────
    if (/anos de experiencia|quanto tempo|quantos anos/.test(t))
      return 'FAST_NUMERIC';
    if (/(nivel|nota|escala|profici|fluencia).*(typescript|javascript|node|react|python|sql|azure|cloud|ingles|english)/.test(t))
      return 'FAST_NUMERIC';
    if (/(typescript|javascript|node|react|python|sql|azure|cloud|ingles|english).*(nivel|nota|escala|profici|fluencia)/.test(t))
      return 'FAST_NUMERIC';
    if (/de 0 a \d|de 1 a \d|numa escala/.test(t))
      return 'FAST_NUMERIC';

    // ── Tipos que precisam de LLM ─────────────────────────────────────────────
    if (/vraxia|human.?rag|sense|open.?source|publicacao|livro|projeto/.test(t))
      return 'PROJECT';
    if (/llm|ia generativ|inteligencia artificial|machine learning|deep learning|genai|gen.?ai/.test(t))
      return 'TECH_STACK';
    if (/langchain|openai|anthropic|huggingface|ollama|rag\b|vetor|embedding|fine.?tun|agente.*ia|ai agent/.test(t))
      return 'TECH_STACK';
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

  // Retorna quais arquivos do vault priorizar (usado quando KB não está ativo)
  getRAGScope(type: QuestionType): string[] {
    switch (type) {
      case 'TECH_STACK':       return ['stack-tecnico', 'experiencia', 'stack', 'profile', 'questionnaire-templates', 'kb/technologies', 'kb/experience'];
      case 'MOTIVATION':       return ['linkedin-github', 'ricardo-profile', 'questionnaire-templates', 'kb/projects', 'kb/achievements'];
      case 'PROJECT':          return ['linkedin-github', 'questionnaire-templates', 'kb/projects'];
      case 'SOFT_SKILL':       return ['questionnaire-templates', 'ricardo-profile', 'kb/achievements', 'kb/experience'];
      case 'COMPANY_SPECIFIC': return ['companies'];
      default:                 return [];
    }
  }

  // ── Resposta principal — 5 camadas ─────────────────────────────────────────

  async answer(question: QuestionnaireQuestion): Promise<QuestionnaireAnswer> {
    const start   = Date.now();
    const qType   = this.classifyQuestion(question);
    const intent  = this.profileLoader?.classifyIntent(question.text) ?? QuestionIntent.UNKNOWN;

    const makeTrace = (layer: DecisionLayer, opts?: Partial<DecisionTrace>): DecisionTrace => ({
      layer, intent, latencyMs: Date.now() - start, ...opts,
    });

    const ret = (answer: string, layer: DecisionLayer, chunks = [] as import('../types/index.js').VaultChunk[], apiCalled = false, traceOpts?: Partial<DecisionTrace>): QuestionnaireAnswer => {
      this.cache.set(question.text, answer);
      this.logger?.log(question.text, answer, chunks, qType, apiCalled);
      return { questionId: question.id, questionText: question.text, answer, trace: makeTrace(layer, traceOpts) };
    };

    // ── Camada 1: FAST determinístico — sempre primeiro, nunca cacheado ────────
    // Runs for ALL question types so that facts (phone, CPF, email, LinkedIn…)
    // bypass the LLM regardless of how the question is classified.
    {
      const fast = this.tryFastAnswer(question);
      if (fast !== null && fast !== '') {
        console.log(`[Questionnaire/FAST/${qType}] "${question.text.slice(0, 60)}..." → "${fast}"`);
        this.logger?.log(question.text, fast, [], qType);
        return { questionId: question.id, questionText: question.text, answer: fast, trace: makeTrace(DecisionLayer.CANDIDATE_FACT) };
      }
    }

    // ── Camada 2: KB Hard Rules — não-negociáveis, antes do cache ─────────────
    if (this.kb) {
      const rule = this.kb.lookupHardRule(question.text);
      if (rule !== null) {
        const answer = this.resolveOptions(rule, question);
        console.log(`[Questionnaire/KB/RULE] "${question.text.slice(0, 60)}..." → "${answer}"`);
        this.logger?.log(question.text, answer, [], qType);
        return { questionId: question.id, questionText: question.text, answer, trace: makeTrace(DecisionLayer.HARD_RULE) };
      }
    }

    // ── Camada 3: Cache (apenas para FAQ/interview/LLM) ───────────────────────
    const cached = this.cache.get(question.text);
    if (cached !== undefined) {
      this.logger?.log(question.text, cached, [], qType);
      return { questionId: question.id, questionText: question.text, answer: cached, trace: makeTrace(DecisionLayer.CACHE, { cacheHit: true }) };
    }

    // ── Camada 4: KB FAQ + Interview Answers (zero LLM) ───────────────────────
    if (this.kb) {
      const exact = this.kb.lookupExact(question.text);
      if (exact !== null) {
        const answer = this.resolveOptions(exact, question);
        console.log(`[Questionnaire/KB/EXACT] "${question.text.slice(0, 60)}..." → "${answer.slice(0, 80)}"`);
        return ret(answer, DecisionLayer.FAQ);
      }
    }

    // ── Camada 5: RAG + Haiku ─────────────────────────────────────────────────
    return this.answerWithLLM(question, qType, start, intent);
  }

  private async answerWithLLM(
    question: QuestionnaireQuestion,
    qType: QuestionType,
    start: number,
    intent: QuestionIntent,
  ): Promise<QuestionnaireAnswer> {
    // Contexto RAG: KB primeiro, fallback ao vault
    let context = '';
    let chunks: import('../types/index.js').VaultChunk[] = [];

    if (this.kb) {
      chunks  = this.kb.retrieveContext(question.text, 5);
      context = chunks.map(c => `[${c.source} > ${c.section}]\n${c.content}`).join('\n\n---\n\n');
    } else {
      const scope = this.getRAGScope(qType);
      chunks  = scope.length
        ? this.retriever.retrieveScoped(question.text, scope, 4)
        : this.retriever.retrieve(question.text, 4);
      context = chunks.map(c => `[${c.source} > ${c.section}]\n${c.content}`).join('\n\n---\n\n');
    }

    const systemPrompt = this.kb?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const optionsText  = question.options?.length
      ? `\nOpções disponíveis (escolha UMA exatamente): ${question.options.join(' | ')}`
      : '';

    // Evidence Engine: injeta fatos verificados do SSoT antes do contexto RAG.
    // O LLM recebe os fatos já estabelecidos e apenas gera a explicação — nunca os infere.
    const evidenceCtx = this.profileLoader?.buildEvidenceContext(question.text) ?? '';
    const fullContext = [evidenceCtx, context].filter(Boolean).join('\n\n---\n\n');

    const userPrompt = `CONTEXTO DO PERFIL:
${fullContext || 'AI Engineer, TypeScript/Node.js, 15 anos exp, SP, remoto preferencial'}

PERGUNTA (tipo: ${qType}): ${question.text}${optionsText}

INSTRUÇÕES:
- Se for seleção, retorne EXATAMENTE uma das opções disponíveis
- Se for texto livre, responda em 1–3 parágrafos (máx 200 palavras)
- NÃO use markdown, bullets ou aspas
- Idioma: mesmo da pergunta`;

    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 350,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      let answer = response.content[0].type === 'text'
        ? response.content[0].text.trim()
        : '';

      // Guard: resposta meta da IA nunca entra no formulário
      if (/n[aã]o consigo (visualizar|ver|responder)|voc[eê] poderia compartilhar|como (uma )?(ia|assistente)|desculpe,? (mas|n[aã]o)/i.test(answer)) {
        console.warn(`[Questionnaire/${qType}] Resposta meta descartada: "${question.text.slice(0, 50)}"`);
        answer = question.options?.[0] ?? '';
        this.logger?.log(question.text, answer, chunks, qType, true);
        return { questionId: question.id, questionText: question.text, answer, trace: { layer: DecisionLayer.LLM, intent, latencyMs: Date.now() - start } };
      }

      // Select/radio: normaliza para opção exata
      answer = this.resolveOptions(answer, question);

      console.log(`[Questionnaire/${qType}] "${question.text.slice(0, 60)}..." → "${answer.slice(0, 80)}"`);
      this.cache.set(question.text, answer);
      this.logger?.log(question.text, answer, chunks, qType, true);
      return { questionId: question.id, questionText: question.text, answer, trace: { layer: DecisionLayer.LLM, intent, latencyMs: Date.now() - start } };

    } catch (err) {
      console.error('[QuestionnaireAgent] Erro LLM:', err);
      return { questionId: question.id, questionText: question.text, answer: '', trace: { layer: DecisionLayer.FALLBACK, intent, latencyMs: Date.now() - start } };
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
    const opts = q.options ?? [];
    const pickOpt = (re: RegExp) => opts.find(o =>
      re.test(o.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))
    ) ?? null;

    // ── First name ────────────────────────────────────────────────────────────
    if (/first.?name|primeiro.?nome|^nome\*?\s*$/.test(text)) {
      if (this.facts['first_name']) return this.facts['first_name'];
      const nome = this.facts['nome'];
      if (nome) return nome.split(/\s+/)[0];
      return null;
    }

    // ── Last name ─────────────────────────────────────────────────────────────
    if (/last.?name|sobrenome|surname|family.?name/.test(text)) {
      if (this.facts['last_name']) return this.facts['last_name'];
      const nome = this.facts['nome'];
      if (nome) return nome.split(/\s+/)[1] ?? nome.split(/\s+/)[0];
      return null;
    }

    // ── Email ────────────────────────────────────────────────────────────────
    if (/\bemail\b|e-mail|e mail|endere.*email|email.*address/.test(text))
      return this.facts['email'] ?? '';

    // ── LinkedIn URL ─────────────────────────────────────────────────────────
    if (/^linkedin\s*\*?\s*$/i.test(q.text.trim()) || /linkedin.*url|url.*linkedin|perfil.*linkedin/.test(text))
      return this.facts['linkedin'] ?? '';

    // ── CPF ──────────────────────────────────────────────────────────────────
    if (/\bcpf\b|cadastro.*pessoa.*fisica|cpf.*candidato/.test(text))
      return this.facts['cpf'] ?? '';

    // ── Telefone / Celular ────────────────────────────────────────────────────
    // Exclude "phone country code" / "código do país" — those need a country selection, not a phone number.
    if (/telefone|celular|\bphone\b|fone|tel\b|numero.*tel|tel.*numero|mobile.*phone|phone.*number/.test(text) &&
        !/country|codigo.*pais|pais/.test(text))
      return this.facts['telefone'] ?? '';

    // ── Parentesco → sempre Não ───────────────────────────────────────────────
    if (/parentesco|grau.*parente|parente.*funcion|funcion.*parente|indica.*parente/.test(text))
      return pickOpt(/n[aã]o|no\b/) ?? 'Não';

    // ── Escola ────────────────────────────────────────────────────────────────
    if (/^escola\s*\*?\s*$/i.test(q.text.trim()))
      return this.facts['escola'] ?? '';

    // ── Escolaridade ─────────────────────────────────────────────────────────
    if (/escolaridade|grau.*instru|nivel.*escol/.test(text)) {
      const grau = this.facts['escolaridade'] ?? 'Graduação';
      return pickOpt(new RegExp(grau, 'i')) ?? grau;
    }

    // ── Disciplina ────────────────────────────────────────────────────────────
    if (/^disciplina\s*\*?\s*$/i.test(q.text.trim()))
      return this.facts['disciplina'] ?? '';

    // ── Salário ───────────────────────────────────────────────────────────────
    if (/salari(o|al)|pretensao|remuneracao/.test(text)) return this.salaryAnswer(q);

    // ── Anos de experiência ───────────────────────────────────────────────────
    if (/anos.*experiencia|experiencia.*anos/.test(text)) {
      if (q.type === 'number') return '15';
      return pickOpt(/^15$|15 anos|mais de 10|acima de 10|senior/) ?? '15';
    }

    // ── PCD → Não ────────────────────────────────────────────────────────────
    if (/pcd|deficiencia|necessidade especial|pessoa com defici/.test(text))
      return pickOpt(/nao|no\b/) ?? 'Não';

    // ── Relocação → Não ──────────────────────────────────────────────────────
    if (/relocar|relocacao|mudar.*cidade|mudanca.*cidade|disponib.*mudar|outra cidade/.test(text))
      return pickOpt(/nao|no\b/) ?? 'Não';

    // ── Viagens → Sim ────────────────────────────────────────────────────────
    if (/viagem|viajar|disponib.*viag/.test(text))
      return pickOpt(/sim|yes/) ?? 'Sim';

    // ── CNH → Sim ────────────────────────────────────────────────────────────
    if (/cnh|carteira.*habilitacao|habilitacao/.test(text))
      return pickOpt(/sim|yes/) ?? 'Sim';

    // ── Autorizado / disponível / imediato / brasileiro → Sim ────────────────
    if (/autorizado|disponivel|imediato|brasileiro/.test(text))
      return pickOpt(/sim|yes/) ?? 'Sim';

    // ── Sponsor / visto → Não ────────────────────────────────────────────────
    if (/sponsor|visto/.test(text))
      return pickOpt(/nao|no\b/) ?? 'Não';

    // ── Equipamento próprio → Sim ─────────────────────────────────────────────
    if (/equipamento.*proprio|notebook.*proprio|computador.*proprio|tem notebook|possui notebook/.test(text))
      return pickOpt(/sim|yes/) ?? 'Sim';

    // ── Experiência com tecnologia → Sim ──────────────────────────────────────
    if (/(tem|possui) (experiencia|conhecimento)|ja (trabalhou|usou|utilizou) com|conhece (o |a |alguma )?/.test(text) &&
        /typescript|javascript|node|react|python|sql|azure|docker|kubernetes|redis|postgres|aws|gcp|cloud|git/.test(text))
      return pickOpt(/sim|yes/) ?? 'Sim';

    // ── Orientação sexual ─────────────────────────────────────────────────────
    if (/orientacao sexual|sexualidade|voce e hetero|voce e homossexual/.test(text))
      return pickOpt(/heter/) ?? 'Heterossexual';

    // ── Identidade de gênero ──────────────────────────────────────────────────
    if (/identidade de genero|voce e cis|cisgenero/.test(text))
      return pickOpt(/cis/) ?? 'Cisgênero';

    // ── Gênero → Masculino ────────────────────────────────────────────────────
    if (/genero|sexo/.test(text))
      return pickOpt(/mascul/) ?? 'Masculino';

    // ── Raça → Branco ────────────────────────────────────────────────────────
    if (/raca|etnia|cor.*pele|autodeclar/.test(text))
      return pickOpt(/branc|white/) ?? pickOpt(/prefer|nao inform/) ?? 'Branco';

    // ── Nível de inglês ───────────────────────────────────────────────────────
    if (/ingles|english/.test(text)) {
      if (q.type === 'number') return '6';
      // Prefer level labels; if only yes/no options ("Possui inglês avançado?"), pick Sim (we do have English)
      return pickOpt(/inter/) ?? pickOpt(/avan[cç]|advanc/) ?? pickOpt(/sim|yes/) ?? 'Intermediário';
    }

    // ── Nível de habilidade técnica ───────────────────────────────────────────
    const isSkillLevel = /(nivel|nota|profici|fluencia|escala|de 0 a|de 1 a|numa escala)/.test(text);
    if (isSkillLevel) {
      const isTopSkill = /typescript|node|javascript/.test(text);
      const num = isTopSkill ? '9' : '8';
      if (q.type === 'number') return num;
      return pickOpt(/avan[cç]|advanc|expert|senior/) ?? pickOpt(/inter/) ?? num;
    }

    // ── candidateFacts: delegado ao CandidateProfileLoader (SSoT) ────────────
    // Perguntas binárias de capacidade consultam o perfil estruturado antes do RAG.
    // O profileLoader nunca pode ser contradito por camadas inferiores.
    if (this.profileLoader) {
      const factAnswer = this.profileLoader.answerBinaryQuestion(q.text, opts);
      if (factAnswer !== null) return factAnswer;
    }

    return null;
  }

  // Normaliza resposta para opção exata em select/radio
  private resolveOptions(raw: string, q: QuestionnaireQuestion): string {
    if ((q.type === 'select' || q.type === 'radio') && q.options?.length) {
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
      const match =
        q.options.find(o => norm(raw) === norm(o)) ??
        q.options.find(o => norm(raw).startsWith(norm(o))) ??
        q.options.find(o => norm(raw).includes(norm(o))) ??
        q.options.find(o => norm(o).includes(norm(raw)));
      if (match) return match;
      return raw.split('\n')[0].trim();
    }
    return raw;
  }

  // Pretensão salarial
  private salaryAnswer(q: QuestionnaireQuestion): string {
    const salary = parseInt(process.env.SALARY_EXPECTATION ?? '14000', 10);
    // LinkedIn names their numeric text fields "single-line-text-...-numeric" (type="text" in HTML,
    // but the form validates the value as a number). Return a raw integer so LinkedIn's validation
    // accepts it — "R$ 14.000" fails because the field expects a pure number, not a currency string.
    if (q.type === 'number' || q.id.includes('numeric')) return String(salary);

    if ((q.type === 'select' || q.type === 'radio') && q.options?.length) {
      const parseNums = (s: string): number[] =>
        (s.match(/\d[\d.,]*/g) ?? [])
          .map(n => parseInt(n.replace(/[.,]/g, ''), 10))
          .map(n => (n > 0 && n < 100 ? n * 1000 : n));

      for (const opt of q.options) {
        const nums = parseNums(opt);
        if (nums.length >= 2 && salary >= Math.min(...nums) && salary <= Math.max(...nums)) return opt;
        if (nums.length === 1 && Math.abs(nums[0] - salary) <= 1000) return opt;
      }
      let best = q.options[0]; let bestDist = Number.MAX_SAFE_INTEGER;
      for (const opt of q.options) {
        const nums = parseNums(opt);
        if (!nums.length) continue;
        const dist = Math.min(...nums.map(n => Math.abs(n - salary)));
        if (dist < bestDist) { bestDist = dist; best = opt; }
      }
      return best;
    }
    return `R$ ${salary.toLocaleString('pt-BR')}`;
  }
}
