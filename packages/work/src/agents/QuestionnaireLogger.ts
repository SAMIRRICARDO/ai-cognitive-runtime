// packages/work/src/agents/QuestionnaireLogger.ts

import fs from 'fs';
import path from 'path';
import { VaultChunk } from '../types/index.js';
import type { QuestionType } from './QuestionnaireAgent.js';

const WORK_DIR   = path.resolve(process.cwd(), '.vraxia-work');
const JSONL_PATH = path.join(WORK_DIR, 'questionnaire-log.jsonl');
const MD_PATH    = path.join(WORK_DIR, 'questionnaire-log.md');

export interface QuestionnaireLogEntry {
  timestamp: string;
  job_id: string;
  job_title: string;
  company: string;
  tipo_detectado: QuestionType;
  pergunta: string;
  resposta_gerada: string;
  chunks_consultados: string[];
}

export class QuestionnaireLogger {
  private session: QuestionnaireLogEntry[] = [];
  private job = { id: '', title: '', company: '', url: '' };

  setJob(id: string, title: string, company: string, url = ''): void {
    this.job     = { id, title, company, url };
    this.session = [];
  }

  log(
    pergunta: string,
    resposta: string,
    chunks: VaultChunk[],
    questionType: QuestionType,
  ): void {
    try {
      const entry: QuestionnaireLogEntry = {
        timestamp:          new Date().toISOString(),
        job_id:             this.job.id,
        job_title:          this.job.title,
        company:            this.job.company,
        tipo_detectado:     questionType,
        pergunta,
        resposta_gerada:    resposta,
        chunks_consultados: chunks.map(c => `${c.source} > ${c.section}`),
      };

      this.session.push(entry);
      fs.mkdirSync(WORK_DIR, { recursive: true });
      fs.appendFileSync(JSONL_PATH, JSON.stringify(entry) + '\n', 'utf-8');
    } catch {
      // silencioso — log nunca interrompe o fluxo principal
    }
  }

  flush(): void {
    if (!this.session.length) return;

    try {
      fs.mkdirSync(WORK_DIR, { recursive: true });

      // Cabeçalho se o arquivo não existe
      const isNew = !fs.existsSync(MD_PATH) || fs.statSync(MD_PATH).size === 0;
      if (isNew) {
        fs.writeFileSync(
          MD_PATH,
          '# VRAXIA WORK — Questionnaire Log\n\n' +
          'Histórico de perguntas e respostas durante candidaturas automatizadas.\n',
          'utf-8',
        );
      }

      const ts    = new Date().toISOString().replace('T', ' ').slice(0, 16);
      let block   = `\n## ${ts} — ${this.job.title} @ ${this.job.company}\n`;
      if (this.job.url) block += `**URL:** ${this.job.url}\n`;
      block += `**Perguntas respondidas:** ${this.session.length}\n\n`;

      this.session.forEach((e, i) => {
        block += `### ${i + 1}. ${e.pergunta}\n\n`;
        block += `**Tipo:** \`${e.tipo_detectado}\`  \n`;
        block += `**Resposta:** ${e.resposta_gerada}\n\n`;
        if (e.chunks_consultados.length) {
          block += `**Fontes RAG:** \`${e.chunks_consultados.join('` · `')}\`\n`;
        }
        block += '\n---\n\n';
      });

      fs.appendFileSync(MD_PATH, block, 'utf-8');
    } catch {
      // silencioso
    }
  }
}
