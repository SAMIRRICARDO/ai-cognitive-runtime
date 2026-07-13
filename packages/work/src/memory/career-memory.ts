// packages/work/src/memory/career-memory.ts
// SQLite tables: company_insights, keyword_performance, question_bank, resume_performance

import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import {
  CompanyInsight,
  KeywordPerformance,
  QuestionBankEntry,
  ResumePerformance,
} from '../types/index.js';

const DB_DIR       = path.resolve(process.cwd(), '.vraxia-work');
const DB_PATH      = path.join(DB_DIR, 'career-memory.db'); // own file — avoids clobbering work.db
const WORK_DB_PATH = path.join(DB_DIR, 'work.db');          // for read/write to job_applications

// ── DB helpers ────────────────────────────────────────────────────────────────

function row2obj(res: ReturnType<Database['exec']>): Record<string, unknown>[] {
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row =>
    Object.fromEntries(cols.map((c, i) => [c, row[i]]))
  );
}

// ── CareerMemory store ────────────────────────────────────────────────────────

export class CareerMemory {
  private db!: Database;
  private SQL!: SqlJsStatic;

  static async create(): Promise<CareerMemory> {
    const cm = new CareerMemory();
    await cm.init();
    return cm;
  }

  private async init(): Promise<void> {
    fs.mkdirSync(DB_DIR, { recursive: true });
    this.SQL = await initSqlJs();
    if (fs.existsSync(DB_PATH)) {
      this.db = new this.SQL.Database(fs.readFileSync(DB_PATH));
    } else {
      this.db = new this.SQL.Database();
    }
    this.migrate();
  }

  private save(): void {
    fs.writeFileSync(DB_PATH, Buffer.from(this.db.export()));
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS company_insights (
        company           TEXT PRIMARY KEY,
        taxa_resposta     REAL DEFAULT 0,
        tempo_medio       INTEGER DEFAULT 0,
        recrutadores      TEXT DEFAULT '[]',
        tecnologias       TEXT DEFAULT '[]',
        candidaturas      INTEGER DEFAULT 0,
        respostas         INTEGER DEFAULT 0,
        updated_at        TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS keyword_performance (
        keyword           TEXT PRIMARY KEY,
        aparicoes         INTEGER DEFAULT 0,
        callbacks         INTEGER DEFAULT 0,
        conversao         REAL DEFAULT 0,
        updated_at        TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS question_bank (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        pergunta          TEXT NOT NULL,
        empresa           TEXT DEFAULT '',
        respostas         TEXT DEFAULT '[]',
        melhor_resposta   TEXT DEFAULT '',
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_qb_pergunta ON question_bank(pergunta, empresa);

      CREATE TABLE IF NOT EXISTS resume_performance (
        versao_cv         TEXT PRIMARY KEY,
        candidaturas      INTEGER DEFAULT 0,
        callbacks         INTEGER DEFAULT 0,
        taxa              REAL DEFAULT 0,
        updated_at        TEXT NOT NULL
      );
    `);
    this.save(); // persist career-memory.db schema
  }

  // ── Company Insights ──────────────────────────────────────────────────────

  recordApplication(company: string, keywords: string[]): void {
    const now = new Date().toISOString();
    this.db.run(`
      INSERT INTO company_insights (company, candidaturas, updated_at)
      VALUES (?,1,?)
      ON CONFLICT(company) DO UPDATE SET
        candidaturas = candidaturas + 1,
        updated_at   = excluded.updated_at
    `, [company, now]);
    for (const kw of keywords) this.recordKeyword(kw);
    this.save();
  }

  recordCallback(company: string): void {
    const now = new Date().toISOString();
    this.db.run(`
      UPDATE company_insights
      SET respostas = respostas + 1,
          taxa_resposta = CAST(respostas + 1 AS REAL) / candidaturas,
          updated_at = ?
      WHERE company = ?
    `, [now, company]);
    this.save();
  }

  getTopCompanies(limit = 10): CompanyInsight[] {
    const rows = row2obj(this.db.exec(
      `SELECT * FROM company_insights ORDER BY taxa_resposta DESC, candidaturas DESC LIMIT ?`,
      [limit],
    ));
    return rows.map(r => ({
      company:             r['company'] as string,
      taxaResposta:        r['taxa_resposta'] as number,
      tempoMedio:          r['tempo_medio'] as number,
      recrutadores:        JSON.parse((r['recrutadores'] as string) || '[]') as string[],
      tecnologiasPedidas:  JSON.parse((r['tecnologias']  as string) || '[]') as string[],
      updatedAt:           r['updated_at'] as string,
    }));
  }

  // ── Keyword Performance ───────────────────────────────────────────────────

  recordKeyword(keyword: string): void {
    const now = new Date().toISOString();
    this.db.run(`
      INSERT INTO keyword_performance (keyword, aparicoes, updated_at)
      VALUES (?,1,?)
      ON CONFLICT(keyword) DO UPDATE SET
        aparicoes  = aparicoes + 1,
        conversao  = CAST(callbacks AS REAL) / (aparicoes + 1),
        updated_at = excluded.updated_at
    `, [keyword.toLowerCase(), now]);
  }

  recordKeywordCallback(keyword: string): void {
    const now = new Date().toISOString();
    this.db.run(`
      UPDATE keyword_performance
      SET callbacks = callbacks + 1,
          conversao = CAST(callbacks + 1 AS REAL) / aparicoes,
          updated_at = ?
      WHERE keyword = ?
    `, [now, keyword.toLowerCase()]);
    this.save();
  }

  getTopKeywords(limit = 20): KeywordPerformance[] {
    const rows = row2obj(this.db.exec(
      `SELECT * FROM keyword_performance ORDER BY conversao DESC, aparicoes DESC LIMIT ?`,
      [limit],
    ));
    return rows.map(r => ({
      keyword:   r['keyword'] as string,
      aparicoes: r['aparicoes'] as number,
      callbacks: r['callbacks'] as number,
      conversao: r['conversao'] as number,
    }));
  }

  // ── Question Bank ─────────────────────────────────────────────────────────

  saveQuestion(pergunta: string, empresa: string, resposta: string, isBest = false): void {
    const now = new Date().toISOString();
    const existing = row2obj(this.db.exec(
      `SELECT respostas, melhor_resposta FROM question_bank WHERE pergunta = ? AND empresa = ?`,
      [pergunta, empresa],
    ));
    if (existing.length) {
      const respostas = JSON.parse((existing[0]['respostas'] as string) || '[]') as string[];
      if (!respostas.includes(resposta)) respostas.push(resposta);
      this.db.run(`
        UPDATE question_bank SET respostas=?, melhor_resposta=?, updated_at=?
        WHERE pergunta=? AND empresa=?
      `, [
        JSON.stringify(respostas.slice(-5)),
        isBest ? resposta : (existing[0]['melhor_resposta'] as string) || resposta,
        now, pergunta, empresa,
      ]);
    } else {
      this.db.run(`
        INSERT INTO question_bank (pergunta, empresa, respostas, melhor_resposta, created_at, updated_at)
        VALUES (?,?,?,?,?,?)
      `, [pergunta, empresa, JSON.stringify([resposta]), resposta, now, now]);
    }
    this.save();
  }

  getQuestions(empresa = '', limit = 50): QuestionBankEntry[] {
    const rows = empresa
      ? row2obj(this.db.exec(`SELECT * FROM question_bank WHERE empresa = ? ORDER BY updated_at DESC LIMIT ?`, [empresa, limit]))
      : row2obj(this.db.exec(`SELECT * FROM question_bank ORDER BY updated_at DESC LIMIT ?`, [limit]));
    return rows.map(r => ({
      pergunta:      r['pergunta'] as string,
      empresa:       r['empresa'] as string,
      respostas:     JSON.parse((r['respostas'] as string) || '[]') as string[],
      melhorResposta: r['melhor_resposta'] as string,
      updatedAt:     r['updated_at'] as string,
    }));
  }

  // ── Resume Performance ────────────────────────────────────────────────────

  recordResumeApplication(versao: string): void {
    const now = new Date().toISOString();
    this.db.run(`
      INSERT INTO resume_performance (versao_cv, candidaturas, updated_at)
      VALUES (?,1,?)
      ON CONFLICT(versao_cv) DO UPDATE SET
        candidaturas = candidaturas + 1,
        taxa         = CAST(callbacks AS REAL) / (candidaturas + 1),
        updated_at   = excluded.updated_at
    `, [versao, now]);
    this.save();
  }

  recordResumeCallback(versao: string): void {
    const now = new Date().toISOString();
    this.db.run(`
      UPDATE resume_performance
      SET callbacks = callbacks + 1,
          taxa      = CAST(callbacks + 1 AS REAL) / candidaturas,
          updated_at = ?
      WHERE versao_cv = ?
    `, [now, versao]);
    this.save();
  }

  getResumePerformance(): ResumePerformance[] {
    const rows = row2obj(this.db.exec(`SELECT * FROM resume_performance ORDER BY taxa DESC`));
    return rows.map(r => ({
      versaoCv:    r['versao_cv'] as string,
      candidaturas: r['candidaturas'] as number,
      callbacks:   r['callbacks'] as number,
      taxa:        r['taxa'] as number,
    }));
  }

  // ── Explainability — operates on work.db directly (avoids stale in-memory clobber) ──

  saveExplainability(jobId: string, reasonApply?: string, reasonScore?: string, reasonFilter?: string): void {
    if (!fs.existsSync(WORK_DB_PATH)) return;
    const workDb = new this.SQL.Database(fs.readFileSync(WORK_DB_PATH));
    try {
      workDb.run(`
        UPDATE job_applications
        SET reason_apply  = COALESCE(?, reason_apply),
            reason_score  = COALESCE(?, reason_score),
            reason_filter = COALESCE(?, reason_filter)
        WHERE id = ?
      `, [reasonApply ?? null, reasonScore ?? null, reasonFilter ?? null, jobId]);
      fs.writeFileSync(WORK_DB_PATH, Buffer.from(workDb.export()));
    } finally {
      workDb.close();
    }
  }

  getExplainability(jobId: string): { reasonApply?: string; reasonScore?: string; reasonFilter?: string } | null {
    if (!fs.existsSync(WORK_DB_PATH)) return null;
    const workDb = new this.SQL.Database(fs.readFileSync(WORK_DB_PATH));
    try {
      const rows = row2obj(workDb.exec(
        `SELECT reason_apply, reason_score, reason_filter FROM job_applications WHERE id = ?`,
        [jobId],
      ));
      if (!rows.length) return null;
      return {
        reasonApply:  rows[0]['reason_apply']  as string | undefined,
        reasonScore:  rows[0]['reason_score']  as string | undefined,
        reasonFilter: rows[0]['reason_filter'] as string | undefined,
      };
    } finally {
      workDb.close();
    }
  }

  // ── Weekly Insights ───────────────────────────────────────────────────────

  async generateWeeklyInsights(apiKey?: string): Promise<string> {
    const topCompanies = this.getTopCompanies(5);
    const topKeywords  = this.getTopKeywords(10);
    const resumePerf   = this.getResumePerformance();

    let weekStats: Record<string, unknown> = { total: 0, applied: 0, interviews: 0 };
    if (fs.existsSync(WORK_DB_PATH)) {
      const workDb = new this.SQL.Database(fs.readFileSync(WORK_DB_PATH));
      try {
        const wrows = row2obj(workDb.exec(`
          SELECT COUNT(*) as total,
            SUM(CASE WHEN status='applied' THEN 1 ELSE 0 END) as applied,
            SUM(CASE WHEN status='interview' THEN 1 ELSE 0 END) as interviews
          FROM job_applications
          WHERE updated_at >= datetime('now', '-7 days')
        `));
        if (wrows.length) weekStats = wrows[0];
      } finally {
        workDb.close();
      }
    }

    const context = `
SEMANA EM NÚMEROS:
- Vagas analisadas: ${weekStats['total']}
- Candidaturas enviadas: ${weekStats['applied']}
- Entrevistas: ${weekStats['interviews']}

TOP EMPRESAS (por taxa de resposta):
${topCompanies.map(c => `- ${c.company}: ${(c.taxaResposta * 100).toFixed(0)}% resposta`).join('\n') || 'Sem dados ainda'}

TOP KEYWORDS PERFORMANDO:
${topKeywords.slice(0, 5).map(k => `- "${k.keyword}": ${k.aparicoes} aparições, ${(k.conversao * 100).toFixed(0)}% conversão`).join('\n') || 'Sem dados ainda'}

PERFORMANCE DE CVs:
${resumePerf.map(r => `- ${r.versaoCv}: ${r.candidaturas} candidaturas, ${(r.taxa * 100).toFixed(0)}% callback`).join('\n') || 'Sem dados ainda'}
`;

    try {
      const client = new Anthropic({ apiKey });
      const res = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `Você é um career coach. Com base nos dados abaixo, gere um relatório semanal conciso com:
1. Análise do desempenho da semana
2. Top 3 insights acionáveis
3. Recomendação principal para a próxima semana

${context}

Responda em português, máximo 3 parágrafos.`,
        }],
      });
      return res.content[0].type === 'text' ? res.content[0].text.trim() : context;
    } catch {
      return context;
    }
  }

  close(): void {
    this.save();
    this.db.close();
  }
}
