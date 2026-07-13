// packages/work/src/agents/InterviewCoach.ts
// Coach de entrevista: gera perguntas prováveis + respostas modelo + feedback interativo

import Anthropic from '@anthropic-ai/sdk';
import { TwinStore } from '../twin/candidate-twin.js';
import { VaultRetriever } from '../rag/retriever.js';

export interface InterviewQuestion {
  id: number;
  category: 'tecnica' | 'comportamental' | 'motivacional' | 'situacional' | 'cultura';
  question: string;
  modelAnswer: string;
  tips: string[];
}

export interface InterviewSession {
  jobId: string;
  company: string;
  role: string;
  questions: InterviewQuestion[];
  generatedAt: string;
}

export interface FeedbackResult {
  score: number;       // 0–10
  strengths: string[];
  improvements: string[];
  betterAnswer: string;
}

export class InterviewCoach {
  private client: Anthropic;

  constructor(
    private twinStore: TwinStore,
    private retriever: VaultRetriever,
    apiKey?: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async prepare(
    jobId: string,
    company: string,
    role: string,
    jobDescription: string,
  ): Promise<InterviewSession> {
    const twin    = this.twinStore.get();
    const context = this.retriever.buildContext(`entrevista ${role} ${company}`, 5);

    const prompt = `
Você é um coach de carreira especializado em entrevistas técnicas para engenheiros sênior.
Gere as 10 perguntas mais prováveis para a entrevista abaixo e as melhores respostas baseadas no perfil do candidato.

CANDIDATO:
- ${twin.identity.name} — ${twin.professional.currentTitle}
- ${twin.professional.yearsExp} anos de experiência
- Stack: ${twin.professional.stack.join(', ')}
- Projetos: ${twin.projects.map(p => p.name).join(', ')}
- Motivações: ${twin.behavioral.motivations.join(', ')}
- Pontos fortes: ${twin.behavioral.strengths.join(', ')}

CONTEXTO VAULT:
${context || 'N/A'}

VAGA:
Empresa: ${company}
Cargo: ${role}
JD (resumo):
${jobDescription.slice(0, 2000)}

Retorne APENAS JSON válido:
{
  "questions": [
    {
      "id": 1,
      "category": "tecnica|comportamental|motivacional|situacional|cultura",
      "question": "<pergunta provável>",
      "modelAnswer": "<resposta modelo para o candidato, 2-3 parágrafos curtos>",
      "tips": ["<dica 1>", "<dica 2>"]
    }
  ]
}
Gere exatamente 10 perguntas variadas nas 5 categorias.
`;

    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

    return {
      jobId,
      company,
      role,
      questions: (parsed.questions ?? []).slice(0, 10) as InterviewQuestion[],
      generatedAt: new Date().toISOString(),
    };
  }

  async feedback(
    question: string,
    candidateAnswer: string,
    modelAnswer: string,
  ): Promise<FeedbackResult> {
    const twin = this.twinStore.get();

    const prompt = `
Avalie a resposta do candidato para esta pergunta de entrevista.

PERGUNTA: ${question}

RESPOSTA DO CANDIDATO: ${candidateAnswer}

RESPOSTA MODELO DE REFERÊNCIA: ${modelAnswer}

PERFIL DO CANDIDATO:
- ${twin.professional.yearsExp} anos de exp., ${twin.professional.seniority}
- Stack: ${twin.professional.stack.slice(0, 5).join(', ')}

Retorne APENAS JSON:
{
  "score": <0-10>,
  "strengths": ["<ponto forte 1>", "<ponto forte 2>"],
  "improvements": ["<melhoria 1>", "<melhoria 2>"],
  "betterAnswer": "<versão melhorada da resposta do candidato, em 2-3 parágrafos>"
}
`;

    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

    return {
      score:       Math.min(10, Math.max(0, parsed.score ?? 5)),
      strengths:   parsed.strengths ?? [],
      improvements: parsed.improvements ?? [],
      betterAnswer: parsed.betterAnswer ?? '',
    };
  }
}
