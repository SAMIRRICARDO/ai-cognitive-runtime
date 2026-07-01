// packages/work/src/api/server.ts
// VRAXIA WORK — Dashboard API Server
// Usage: npx tsx src/api/server.ts
// Dashboard: http://localhost:3001/work

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import initSqlJs from 'sql.js';
import type { Database, SqlJsStatic } from 'sql.js';
import { ModalityDetector } from '../engine/modality-detector.js';

const modalityDetector = new ModalityDetector();

const PORT       = 3001;
const WORK_DIR   = path.resolve(process.cwd(), '.vraxia-work');
const DB_PATH    = path.join(WORK_DIR, 'work.db');
const JSONL_PATH = path.join(WORK_DIR, 'questionnaire-log.jsonl');
const DASH_DIR   = path.resolve(process.cwd(), 'dashboard');

// ── SQL engine (cached) ──────────────────────────────────────────────────────
let SQL: SqlJsStatic | null = null;

async function getSQLEngine(): Promise<SqlJsStatic> {
  if (!SQL) SQL = await initSqlJs();
  return SQL;
}

async function withDb<T>(fn: (db: Database) => T): Promise<T | null> {
  if (!fs.existsSync(DB_PATH)) return null;
  const engine = await getSQLEngine();
  const buf = fs.readFileSync(DB_PATH);
  const db = new engine.Database(buf);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function dbQuery(db: Database, sql: string, params: (string | number | null)[] = []): Record<string, unknown>[] {
  const res = db.exec(sql, params);
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row =>
    Object.fromEntries(cols.map((c, i) => [c, row[i]]))
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function detectPlatform(url: string): string {
  const u = (url ?? '').toLowerCase();
  if (u.includes('linkedin.com')) return 'LinkedIn';
  if (u.includes('gupy'))         return 'Gupy';
  return 'Outro';
}

function readJsonl(): Record<string, unknown>[] {
  if (!fs.existsSync(JSONL_PATH)) return [];
  return fs.readFileSync(JSONL_PATH, 'utf-8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean) as Record<string, unknown>[];
}

function estimateCost(entries: Record<string, unknown>[]): number {
  const fastTypes = new Set(['FAST_YESNO', 'FAST_NUMERIC', 'FAST_SALARY']);
  const llmCalls = entries.filter(e => !fastTypes.has(e['tipo_detectado'] as string)).length;
  // Haiku: $0.80/MTok in + $4.00/MTok out; ~500 in + 150 out per call
  return llmCalls * (500 * 0.80 + 150 * 4.0) / 1_000_000;
}

// ── CORS middleware ───────────────────────────────────────────────────────────
function setCors(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(setCors);
app.use(express.json());

// Static dashboard at /work
app.use('/work', express.static(DASH_DIR));
app.get('/work', (_req: Request, res: Response) => {
  res.sendFile(path.join(DASH_DIR, 'index.html'));
});

// ── GET /api/work/stats ───────────────────────────────────────────────────────
app.get('/api/work/stats', async (_req: Request, res: Response) => {
  try {
    const entries = readJsonl();

    const stats = await withDb(db => {
      const rows = dbQuery(db,
        `SELECT status, COUNT(*) as cnt FROM job_applications GROUP BY status`
      );
      const byStatus: Record<string, number> = {};
      let totalScanned = 0, totalApplied = 0;
      for (const row of rows) {
        byStatus[row['status'] as string] = row['cnt'] as number;
        totalScanned += row['cnt'] as number;
        if (row['status'] === 'applied') totalApplied = row['cnt'] as number;
      }

      const lastRunRow = dbQuery(db,
        `SELECT MAX(updated_at) as lr FROM job_applications`
      );

      // Contagem por modalidade (CPU-only)
      const allRows = dbQuery(db, `SELECT job_title, location, description FROM job_applications`);
      let remoteCount = 0, onsiteCount = 0;
      for (const r of allRows) {
        const geo = modalityDetector.evaluate({
          title: (r['job_title'] as string) ?? '',
          location: (r['location'] as string) ?? '',
          description: (r['description'] as string) ?? '',
        });
        if (geo.modality === 'REMOTO') remoteCount++;
        else if (geo.modality === 'HÍBRIDO' || geo.modality === 'PRESENCIAL') onsiteCount++;
      }

      return {
        totalScanned, totalApplied,
        filterRate: totalScanned > 0 ? totalApplied / totalScanned : 0,
        lastRun: lastRunRow[0]?.['lr'] ?? null,
        byStatus, remoteCount, onsiteCount,
      };
    });

    res.json({
      ...(stats ?? { totalScanned: 0, totalApplied: 0, filterRate: 0, lastRun: null, byStatus: {} }),
      estimatedCostUsd: estimateCost(entries),
      questionnaireEntries: entries.length,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/work/applications ────────────────────────────────────────────────
app.get('/api/work/applications', async (req: Request, res: Response) => {
  try {
    const { status, platform, period, search, modality } = req.query as Record<string, string>;

    const rows = await withDb(db => {
      let sql = `SELECT * FROM job_applications WHERE 1=1`;
      const params: (string | number | null)[] = [];

      if (status && status !== 'all') {
        sql += ` AND status = ?`;
        params.push(status);
      }

      if (period && period !== 'all') {
        const days = period === 'hoje' ? 1 : period === '7d' ? 7 : 30;
        const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
        sql += ` AND updated_at >= ?`;
        params.push(cutoff);
      }

      if (search) {
        sql += ` AND (LOWER(company) LIKE ? OR LOWER(job_title) LIKE ?)`;
        const like = `%${search.toLowerCase()}%`;
        params.push(like, like);
      }

      sql += ` ORDER BY updated_at DESC LIMIT 300`;
      return dbQuery(db, sql, params);
    });

    let result = (rows ?? []).map(r => {
      const geo = modalityDetector.evaluate({
        title: (r['job_title'] as string) ?? '',
        location: (r['location'] as string) ?? '',
        description: (r['description'] as string) ?? '',
      });
      return {
        ...r,
        platform: detectPlatform(r['linkedin_url'] as string),
        modality: geo.modality,
        modalityReason: geo.reason,
      };
    });

    if (platform && platform !== 'all') {
      result = result.filter(r => r['platform'] === platform);
    }

    if (modality && modality !== 'all') {
      result = result.filter(r => r['modality'] === modality);
    }

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/work/questionnaire-log ──────────────────────────────────────────
app.get('/api/work/questionnaire-log', (_req: Request, res: Response) => {
  try {
    const entries = readJsonl();
    const grouped: Record<string, { job_id: string; job_title: string; company: string; entries: Record<string, unknown>[] }> = {};
    for (const e of entries) {
      const key = (e['job_id'] as string) || 'unknown';
      if (!grouped[key]) {
        grouped[key] = {
          job_id: e['job_id'] as string,
          job_title: e['job_title'] as string,
          company: e['company'] as string,
          entries: [],
        };
      }
      grouped[key].entries.push(e);
    }
    res.json(Object.values(grouped));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/work/chart/daily ─────────────────────────────────────────────────
app.get('/api/work/chart/daily', async (_req: Request, res: Response) => {
  try {
    const labels: string[] = [];
    const applied: number[] = [];
    const scanned: number[] = [];

    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      const dateStr = d.toISOString().slice(0, 10);
      labels.push(d.toLocaleDateString('pt-BR', { month: 'short', day: 'numeric' }));

      const dayData = await withDb(db => {
        const aRow = dbQuery(db,
          `SELECT COUNT(*) as c FROM job_applications WHERE status = 'applied' AND DATE(applied_at) = ?`,
          [dateStr]
        );
        const sRow = dbQuery(db,
          `SELECT COUNT(*) as c FROM job_applications WHERE DATE(updated_at) = ?`,
          [dateStr]
        );
        return { a: (aRow[0]?.['c'] as number) ?? 0, s: (sRow[0]?.['c'] as number) ?? 0 };
      });

      applied.push(dayData?.a ?? 0);
      scanned.push(dayData?.s ?? 0);
    }

    const cumulative: number[] = [];
    let acc = 0;
    for (const v of applied) { acc += v; cumulative.push(acc); }

    res.json({ labels, applied, scanned, cumulative });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/work/chart/companies ─────────────────────────────────────────────
app.get('/api/work/chart/companies', async (_req: Request, res: Response) => {
  try {
    const rows = await withDb(db =>
      dbQuery(db,
        `SELECT company, COUNT(*) as cnt FROM job_applications GROUP BY company ORDER BY cnt DESC LIMIT 10`
      )
    );
    res.json({
      labels: (rows ?? []).map(r => r['company']),
      counts: (rows ?? []).map(r => r['cnt']),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/work/scheduler/history ──────────────────────────────────────────
app.get('/api/work/scheduler/history', (_req: Request, res: Response) => {
  try {
    const histPath = path.join(WORK_DIR, 'scheduler-history.jsonl');
    if (!fs.existsSync(histPath)) { res.json([]); return; }
    const entries = fs.readFileSync(histPath, 'utf-8')
      .split('\n').filter(l => l.trim())
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .reverse() // mais recente primeiro
      .slice(0, 30);
    res.json(entries);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── POST /api/work/hunt/start ─────────────────────────────────────────────────
let huntProcess: ChildProcess | null = null;

app.post('/api/work/hunt/start', (req: Request, res: Response) => {
  if (huntProcess && !huntProcess.killed) {
    res.status(409).json({ error: 'Hunt já em execução', pid: huntProcess.pid });
    return;
  }

  const { platform = 'linkedin', dryRun = true, limit = 10, logQuestions = false } = req.body as {
    platform?: string; dryRun?: boolean; limit?: number; logQuestions?: boolean;
  };

  const args = ['tsx', 'src/cli/hunt.ts', '--platform', platform, '--limit', String(limit)];
  if (dryRun)       args.push('--dry-run');
  if (logQuestions) args.push('--log-questions');

  huntProcess = spawn('npx', args, { cwd: process.cwd(), stdio: 'pipe', shell: true });

  huntProcess.on('exit', () => { huntProcess = null; });

  res.json({
    pid: huntProcess.pid,
    started: new Date().toISOString(),
    command: `npx ${args.join(' ')}`,
  });
});

// ── GET /api/work/hunt/status ─────────────────────────────────────────────────
app.get('/api/work/hunt/status', (_req: Request, res: Response) => {
  res.json({ running: !!(huntProcess && !huntProcess.killed), pid: huntProcess?.pid ?? null });
});

// ── POST /api/work/hunt/stop ──────────────────────────────────────────────────
app.post('/api/work/hunt/stop', (_req: Request, res: Response) => {
  if (huntProcess && !huntProcess.killed) {
    huntProcess.kill('SIGTERM');
    huntProcess = null;
    res.json({ stopped: true });
  } else {
    res.json({ stopped: false, reason: 'Nenhum hunt em execução' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  VRAXIA WORK — Dashboard API`);
  console.log(`  → Dashboard: http://localhost:${PORT}/work`);
  console.log(`  → API base:  http://localhost:${PORT}/api/work\n`);
  if (!fs.existsSync(DASH_DIR)) {
    console.warn(`  [WARN] Dashboard não encontrado: ${DASH_DIR}`);
  }
  if (!fs.existsSync(DB_PATH)) {
    console.warn(`  [WARN] Banco não encontrado: ${DB_PATH} (execute o hunt primeiro)`);
  }
});
