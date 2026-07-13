// packages/work/src/agents/StatusTracker.ts
// Usa sql.js (pure JS/WASM) — sem dependência de compilação C++

import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { JobApplication, ApplicationStatus } from '../types/index.js';

const DB_DIR = path.resolve(process.cwd(), '.vraxia-work');
const DB_PATH = path.join(DB_DIR, 'work.db');

export class StatusTracker {
  private db!: Database;
  private SQL!: SqlJsStatic;

  static async create(): Promise<StatusTracker> {
    const tracker = new StatusTracker();
    await tracker.init();
    return tracker;
  }

  private async init(): Promise<void> {
    fs.mkdirSync(DB_DIR, { recursive: true });

    this.SQL = await initSqlJs();

    // Carrega DB existente ou cria novo
    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      this.db = new this.SQL.Database(fileBuffer);
    } else {
      this.db = new this.SQL.Database();
    }

    this.migrate();
  }

  private save(): void {
    const data = this.db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS job_applications (
        id TEXT PRIMARY KEY,
        job_title TEXT NOT NULL,
        company TEXT NOT NULL,
        location TEXT,
        linkedin_url TEXT NOT NULL,
        description TEXT,
        is_easy_apply INTEGER DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'scanned',
        score_total INTEGER DEFAULT 0,
        score_action TEXT,
        score_reason TEXT,
        questionnaire_answers TEXT,
        scanned_at TEXT,
        applied_at TEXT,
        updated_at TEXT NOT NULL,
        notes TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_status ON job_applications(status);
      CREATE INDEX IF NOT EXISTS idx_company ON job_applications(company);
    `);
    // Migration: add platform column for existing databases
    try {
      this.db.run(`ALTER TABLE job_applications ADD COLUMN platform TEXT DEFAULT 'linkedin'`);
    } catch { /* column already exists */ }
    this.save();
  }

  upsert(app: JobApplication): void {
    this.db.run(`
      INSERT INTO job_applications (
        id, job_title, company, location, linkedin_url, description,
        is_easy_apply, status, score_total, score_action, score_reason,
        questionnaire_answers, scanned_at, applied_at, updated_at, notes, platform
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        score_total = excluded.score_total,
        score_action = excluded.score_action,
        score_reason = excluded.score_reason,
        questionnaire_answers = excluded.questionnaire_answers,
        applied_at = excluded.applied_at,
        updated_at = excluded.updated_at,
        notes = excluded.notes,
        platform = excluded.platform
    `, [
      app.job.id,
      app.job.title,
      app.job.company,
      app.job.location,
      app.job.linkedinUrl,
      app.job.description?.slice(0, 2000) ?? '',
      app.job.isEasyApply ? 1 : 0,
      app.status,
      app.score.total,
      app.score.action,
      app.score.reason,
      app.questionnaireAnswers ? JSON.stringify(app.questionnaireAnswers) : null,
      app.job.scannedAt,
      app.appliedAt ?? null,
      new Date().toISOString(),
      app.notes ?? null,
      app.job.platform ?? 'linkedin',
    ]);
    this.save();
  }

  updateStatus(jobId: string, status: ApplicationStatus, notes?: string): void {
    const now = new Date().toISOString();
    this.db.run(`
      UPDATE job_applications
      SET status = ?, updated_at = ?,
          notes = COALESCE(?, notes),
          applied_at = CASE WHEN ? = 'applied' THEN ? ELSE applied_at END
      WHERE id = ?
    `, [status, now, notes ?? null, status, now, jobId]);
    this.save();
  }

  alreadyApplied(jobId: string): boolean {
    const res = this.db.exec(
      `SELECT status FROM job_applications WHERE id = ?`, [jobId]
    );
    if (!res.length || !res[0].values.length) return false;
    const status = res[0].values[0][0] as string;
    return ['applied', 'questionnaire_done', 'interview'].includes(status);
  }

  getStats(): Record<string, number> {
    const res = this.db.exec(
      `SELECT status, COUNT(*) as count FROM job_applications GROUP BY status`
    );
    if (!res.length) return {};
    return Object.fromEntries(
      res[0].values.map(row => [row[0] as string, row[1] as number])
    );
  }

  listByStatus(status: ApplicationStatus, limit = 50): any[] {
    const res = this.db.exec(
      `SELECT * FROM job_applications WHERE status = ? ORDER BY updated_at DESC LIMIT ?`,
      [status, limit]
    );
    if (!res.length) return [];
    const cols = res[0].columns;
    return res[0].values.map(row =>
      Object.fromEntries(cols.map((c, i) => [c, row[i]]))
    );
  }

  close(): void {
    this.save();
    this.db.close();
  }
}
