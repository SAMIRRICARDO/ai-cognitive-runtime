// packages/work/src/agents/ResumeAgent.ts
// Gera versão do currículo adaptada para cada vaga (usa Sonnet para qualidade)

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { TwinStore } from '../twin/candidate-twin.js';
import { VaultRetriever } from '../rag/retriever.js';

const VAULT_DIR = path.resolve(process.cwd(), '.vraxia-work', 'resumes');

export interface ResumeResult {
  jobId: string;
  filePath: string;
  summary: string;
  keyChanges: string[];
}

export class ResumeAgent {
  private client: Anthropic;

  constructor(
    private twinStore: TwinStore,
    private retriever: VaultRetriever,
    apiKey?: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(
    jobId: string,
    jobTitle: string,
    company: string,
    jobDescription: string,
  ): Promise<ResumeResult> {
    const twin = this.twinStore.get();
    const cvContext = this.retriever.buildContext(`experiência projetos ${jobTitle}`, 8);

    const prompt = `
Você é um especialista em redação de currículos técnicos para engenheiros de software sênior.
Crie uma versão do currículo do candidato otimizada especificamente para a vaga abaixo.

CANDIDATO:
Nome: ${twin.identity.name}
Cargo: ${twin.professional.currentTitle}
E-mail: ${twin.identity.email}
LinkedIn: ${twin.identity.linkedin}
GitHub: ${twin.identity.github}
Localização: ${twin.identity.location}

EXPERIÊNCIA (${twin.professional.yearsExp} anos):
${twin.history.map(h => `• ${h.role} @ ${h.company} (${h.period})\n  ${h.highlights.join(' | ')}\n  Tech: ${h.tech.join(', ')}`).join('\n\n')}

PROJETOS:
${twin.projects.map(p => `• ${p.name}: ${p.description}\n  Tech: ${p.tech.join(', ')}`).join('\n\n')}

SKILLS:
${twin.professional.skills.join(', ')}

CONTEXTO ADICIONAL DO VAULT:
${cvContext || 'N/A'}

VAGA ALVO:
Empresa: ${company}
Título: ${jobTitle}
Descrição:
${jobDescription.slice(0, 2500)}

INSTRUÇÕES:
1. Reordene as experiências por relevância para ESTA vaga específica
2. Injete naturalmente keywords da JD nas descrições de forma verdadeira
3. Adapte o resumo profissional para ressoar com esta vaga
4. Mantenha tom profissional, conciso e autêntico — NÃO invente experiências
5. Use markdown com seções: Resumo, Experiência, Projetos, Skills, Formação/Certificações

No final, adicione uma seção especial:
## Mudanças Realizadas
Lista bullet das principais adaptações feitas para esta vaga.

Retorne o currículo completo em markdown.
`;

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].type === 'text' ? response.content[0].text.trim() : '';

    // Extract key changes section
    const changesMatch = content.match(/## Mudanças Realizadas\n([\s\S]*?)(?=\n##|$)/);
    const keyChanges = changesMatch
      ? changesMatch[1].split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('•')).map(l => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean)
      : [];

    // Extract summary (first paragraph after # heading)
    const summaryMatch = content.match(/## Resumo\n([\s\S]*?)(?=\n##)/);
    const summary = summaryMatch ? summaryMatch[1].trim().slice(0, 300) : '';

    // Save to file
    fs.mkdirSync(VAULT_DIR, { recursive: true });
    const filePath = path.join(VAULT_DIR, `resume_${jobId}.md`);
    const header = `---\njob_id: ${jobId}\njob_title: ${jobTitle}\ncompany: ${company}\ngenerated_at: ${new Date().toISOString()}\n---\n\n`;
    fs.writeFileSync(filePath, header + content, 'utf-8');

    console.log(`[ResumeAgent] CV gerado: ${filePath}`);
    return { jobId, filePath, summary, keyChanges };
  }
}
