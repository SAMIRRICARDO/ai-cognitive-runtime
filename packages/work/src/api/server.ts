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
import { TwinStore } from '../twin/candidate-twin.js';
import { CareerMemory } from '../memory/career-memory.js';
import { ATSAgent } from '../agents/ATSAgent.js';
import { ResumeAgent } from '../agents/ResumeAgent.js';
import { InterviewCoach } from '../agents/InterviewCoach.js';
import { SalaryAdvisor } from '../agents/SalaryAdvisor.js';
import { LearningAgent } from '../agents/LearningAgent.js';
import { NetworkingAgent } from '../agents/NetworkingAgent.js';
import { VaultRetriever } from '../rag/retriever.js';
import { AgentRegistry } from '../marketplace/registry.js';

const modalityDetector = new ModalityDetector();
const retriever = new VaultRetriever();
const twinStore = new TwinStore();

// Executa migração no startup para garantir colunas granulares no DB
import('../application/ApplicationRepository.js')
  .then(m => m.ApplicationRepository.create())
  .then(repo => { repo.close(); console.log('[Server] Migração DB: OK'); })
  .catch(err => console.warn('[Server] Migração DB ignorada:', String(err).slice(0, 80)));

// Lazy-init singletons for agents that need async setup
let _memory: CareerMemory | null = null;
let _networking: NetworkingAgent | null = null;
let _registry: AgentRegistry | null = null;

async function getMemory(): Promise<CareerMemory> {
  if (!_memory) _memory = await CareerMemory.create();
  return _memory;
}
async function getNetworking(): Promise<NetworkingAgent> {
  if (!_networking) _networking = await NetworkingAgent.create(twinStore, process.env['ANTHROPIC_API_KEY']);
  return _networking;
}
async function getRegistry(): Promise<AgentRegistry> {
  if (!_registry) _registry = await AgentRegistry.create();
  return _registry;
}

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
function tryParseJson<T>(val: unknown, fallback: T): T {
  if (Array.isArray(val)) return val as unknown as T;
  if (typeof val !== 'string' || !val) return fallback;
  try { return JSON.parse(val) as T; } catch { return fallback; }
}

function detectPlatform(row: Record<string, unknown>): string {
  const dbPlatform = (row['platform'] as string | null) ?? '';
  if (dbPlatform === 'catho')   return 'Catho';
  if (dbPlatform === 'gupy')    return 'Gupy';
  if (dbPlatform === 'linkedin') return 'LinkedIn';
  const url = ((row['linkedin_url'] as string) ?? '').toLowerCase();
  if (url.includes('linkedin.com'))  return 'LinkedIn';
  if (url.includes('gupy'))          return 'Gupy';
  if (url.includes('catho.com.br'))  return 'Catho';
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

function estimateCost(entries: Record<string, unknown>[], scoringCalls = 0): number {
  // api_called=true indica chamada LLM real (QuestionnaireAgent)
  const llmCalls = entries.filter(e => e['api_called'] === true).length;
  // Haiku: $0.80/MTok in + $4.00/MTok out
  // Questionnaire: ~650 out tokens por call; Scoring: ~4000 in + 256 out tokens por call
  const questionnaireCost = llmCalls * (500 * 0.80 + 650 * 4.0) / 1_000_000;
  const scoringCost = scoringCalls * (4000 * 0.80 + 256 * 4.0) / 1_000_000;
  return questionnaireCost + scoringCost;
}

// ── CORS middleware ───────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:3001',
  'http://localhost:3000',
  /^https:\/\/vraxia.*\.vercel\.app$/,
  /^https:\/\/.*\.vercel\.app$/,
  /^https:\/\/.*\.trycloudflare\.com$/,
  /^https:\/\/.*\.ngrok-free\.app$/,
  /^https:\/\/.*\.ngrok\.io$/,
];
if (process.env.DASHBOARD_URL) ALLOWED_ORIGINS.push(process.env.DASHBOARD_URL);

function setCors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin ?? '';
  const allowed = ALLOWED_ORIGINS.some(p =>
    typeof p === 'string' ? p === origin : p.test(origin)
  );
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
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

// ── GET /api/work/health ─────────────────────────────────────────────────────
app.get('/api/work/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// ── GET /api/work/db-mtime ───────────────────────────────────────────────────
// Lightweight endpoint for dashboard polling — returns DB + JSONL modification
// timestamps so the client only triggers a full refresh when data actually changed.
app.get('/api/work/db-mtime', (_req: Request, res: Response) => {
  const dbMtime    = fs.existsSync(DB_PATH)    ? fs.statSync(DB_PATH).mtimeMs    : 0;
  const jsonlMtime = fs.existsSync(JSONL_PATH) ? fs.statSync(JSONL_PATH).mtimeMs : 0;
  const huntPid    = fs.existsSync(path.join(WORK_DIR, 'hunt.pid'))
    ? Number(fs.readFileSync(path.join(WORK_DIR, 'hunt.pid'), 'utf-8').trim())
    : (huntProcess?.pid ?? null);
  res.json({ dbMtime, jsonlMtime, mtime: Math.max(dbMtime, jsonlMtime), huntPid });
});

// ── GET /api/work/tunnel-url ──────────────────────────────────────────────────
app.get('/api/work/tunnel-url', (_req: Request, res: Response) => {
  const tunnelFile = path.join(WORK_DIR, 'tunnel-url.txt');
  const url = fs.existsSync(tunnelFile) ? fs.readFileSync(tunnelFile, 'utf-8').trim() : null;
  res.json({ url, active: !!url });
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
        platform: detectPlatform(r),
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
    res.json(Object.values(grouped).reverse());
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

  const { platform = 'linkedin', dryRun = false, limit = 10, logQuestions = false } = req.body as {
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

// ── GET /api/work/analytics ───────────────────────────────────────────────────
app.get('/api/work/analytics', async (_req: Request, res: Response) => {
  try {
    const sql  = await getSQLEngine();
    const db   = fs.existsSync(DB_PATH) ? new sql.Database(fs.readFileSync(DB_PATH)) : null;

    const funnel = { scanned: 0, applied: 0, queued: 0, interview: 0, offer: 0 };
    const topCompanies: { company: string; count: number }[] = [];
    const platformCounts: Record<string, number> = {};
    const scoreBuckets = { skip: 0, review: 0, apply_bucket: 0 };
    let weeklyInsights = '';

    // try/finally garante db.close() mesmo se qualquer exec() lançar exceção.
    // Sem isso, instâncias WASM acumulam no heap enquanto o servidor estiver rodando.
    try {
      if (db) {
        const exec = (sql2: string, params: (string | number)[] = []) => {
          const r = db.exec(sql2, params);
          if (!r.length) return [];
          return r[0].values.map(row => Object.fromEntries(r[0].columns.map((c, i) => [c, row[i]])));
        };

        const counts = exec(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status='applied' THEN 1 ELSE 0 END) as applied,
            SUM(CASE WHEN status='queued'  THEN 1 ELSE 0 END) as queued,
            SUM(CASE WHEN status='interview' THEN 1 ELSE 0 END) as interview,
            SUM(CASE WHEN status='offer' THEN 1 ELSE 0 END) as offer_count
          FROM job_applications
        `);
        if (counts.length) {
          funnel.scanned   = (counts[0]['total']        as number) ?? 0;
          funnel.applied   = (counts[0]['applied']      as number) ?? 0;
          funnel.queued    = (counts[0]['queued']        as number) ?? 0;
          funnel.interview = (counts[0]['interview']     as number) ?? 0;
          funnel.offer     = (counts[0]['offer_count']   as number) ?? 0;
        }

        const comps = exec(`
          SELECT company, COUNT(*) as cnt FROM job_applications
          WHERE status = 'applied' GROUP BY company ORDER BY cnt DESC LIMIT 8
        `);
        comps.forEach(r => topCompanies.push({ company: r['company'] as string, count: r['cnt'] as number }));

        const plats = exec(`SELECT platform, COUNT(*) as cnt FROM job_applications GROUP BY platform`);
        plats.forEach(r => { platformCounts[r['platform'] as string || 'Outro'] = r['cnt'] as number; });

        const scores = exec(`SELECT score_total FROM job_applications WHERE score_total IS NOT NULL`);
        scores.forEach(r => {
          const s = r['score_total'] as number;
          if (s >= 75) scoreBuckets.apply_bucket++;
          else if (s >= 50) scoreBuckets.review++;
          else scoreBuckets.skip++;
        });

        // Try career-memory insights if tables exist
        try {
          const insightRows = exec(`
            SELECT COUNT(*) as t,
              SUM(CASE WHEN status='applied' THEN 1 ELSE 0 END) as a,
              SUM(CASE WHEN status='interview' THEN 1 ELSE 0 END) as i
            FROM job_applications WHERE updated_at >= datetime('now','-7 days')
          `);
          if (insightRows.length) {
            const week = insightRows[0];
            const total  = (week['t'] as number) || 0;
            const applied2 = (week['a'] as number) || 0;
            const conv = total ? ((applied2 / total) * 100).toFixed(0) : 0;
            weeklyInsights = `Esta semana: ${total} vagas analisadas, ${applied2} candidaturas enviadas (${conv}% conversão).`;
          }
        } catch { /* career-memory tables may not exist yet */ }
      }
    } finally {
      db?.close();
    }

    res.json({ funnel, topCompanies, platformCounts, scoreBuckets, weeklyInsights });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/work/explain/:jobId ──────────────────────────────────────────────
app.get('/api/work/explain/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const sql = await getSQLEngine();
    if (!fs.existsSync(DB_PATH)) { res.status(404).json({ error: 'DB not found' }); return; }
    const db  = new sql.Database(fs.readFileSync(DB_PATH));
    const r   = db.exec(
      `SELECT reason_apply, reason_score, reason_filter, score_total, score_reason, status, company, job_title
       FROM job_applications WHERE id = ?`,
      [String(jobId)],
    );
    db.close();
    if (!r.length || !r[0].values.length) { res.status(404).json({ error: 'Not found' }); return; }
    const cols = r[0].columns;
    const row  = Object.fromEntries(cols.map((c, i) => [c, r[0].values[0][i]]));
    res.json({
      jobId,
      reasonApply:  row['reason_apply']  ?? null,
      reasonScore:  row['reason_score']  ?? null,
      reasonFilter: row['reason_filter'] ?? null,
      scoreTotal:   row['score_total']   ?? null,
      scoreReason:  row['score_reason']  ?? null,
      status:       row['status']        ?? null,
      company:      row['company']       ?? null,
      jobTitle:     row['job_title']     ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/work/chat ────────────────────────────────────────────────────────
app.post('/api/work/chat', async (req: Request, res: Response) => {
  try {
    const { message } = req.body as { message: string };
    if (!message) { res.status(400).json({ error: 'message required' }); return; }

    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      res.json({ reply: '⚠️ ANTHROPIC_API_KEY não configurada. Configure a chave para usar o chat.', intent: 'SETTINGS', actions: [] });
      return;
    }

    // Load stats for context
    let statsCtx = '';
    try {
      const sql = await getSQLEngine();
      if (fs.existsSync(DB_PATH)) {
        const db = new sql.Database(fs.readFileSync(DB_PATH));
        const r  = db.exec(`SELECT COUNT(*) as t, SUM(CASE WHEN status='applied' THEN 1 ELSE 0 END) as a FROM job_applications`);
        db.close();
        if (r.length) {
          statsCtx = `Stats: ${r[0].values[0][0]} vagas no DB, ${r[0].values[0][1]} candidaturas enviadas.`;
        }
      }
    } catch { /* ignore */ }

    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const INTENTS = ['HUNT','RESUME','INTERVIEW','SALARY','ANALYTICS','NETWORK','CAREER','EXPLAIN','SETTINGS'] as const;
    type Intent = typeof INTENTS[number];

    const ACTIONS: Record<Intent, { label: string; action: string }[]> = {
      HUNT:      [{ label: '🚀 Candidatar 5 vagas', action: 'hunt:run:5' }, { label: '👁 Dry-run', action: 'hunt:dry-run' }],
      RESUME:    [{ label: '📋 Ver candidaturas', action: 'nav:table' }, { label: '📊 Analytics', action: 'nav:analytics' }],
      INTERVIEW: [{ label: '📋 Ver candidaturas', action: 'nav:table' }],
      SALARY:    [{ label: '📊 Ver analytics', action: 'nav:analytics' }],
      ANALYTICS: [{ label: '📊 Ver analytics', action: 'nav:analytics' }, { label: '📋 Ver candidaturas', action: 'nav:table' }],
      NETWORK:   [{ label: '🏠 Home', action: 'nav:home' }],
      CAREER:    [{ label: '🚀 Candidatar vagas', action: 'hunt:run:5' }, { label: '📊 Analytics', action: 'nav:analytics' }],
      EXPLAIN:   [{ label: '📋 Ver candidaturas', action: 'nav:table' }],
      SETTINGS:  [{ label: '⚙️ Hunt Mode', action: 'nav:hunt' }],
    };

    const prompt = `Você é o VRAXIA Career OS, assistente de carreira do Samir Ricardo (Dev fullstack sênior).
${statsCtx}

Responda à mensagem do usuário de forma concisa, útil e em português.
No final retorne JSON assim (na última linha, após dupla quebra de linha):

{"intent":"<${INTENTS.join('|')}>","reply":"<sua resposta>"}

Mensagem do usuário: ${message}`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const text  = response.content[0].type === 'text' ? response.content[0].text : '';
    const match = text.match(/\{[^}]*"intent"[^}]*"reply"[^}]*\}|\{[^}]*"reply"[^}]*"intent"[^}]*\}/);
    let intent: Intent = 'CAREER';
    let reply  = text.replace(/\{.*\}$/s, '').trim() || text;

    if (match) {
      try {
        const parsed = JSON.parse(match[0]) as { intent: Intent; reply: string };
        intent = INTENTS.includes(parsed.intent) ? parsed.intent : 'CAREER';
        reply  = parsed.reply || reply;
      } catch { /* keep defaults */ }
    }

    res.json({ reply, intent, actions: ACTIONS[intent] ?? [] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/work/home/stats ──────────────────────────────────────────────────
// Retorna stats enriquecidos para a home: vagas +90%, streak, etc.
app.get('/api/work/home/stats', async (_req: Request, res: Response) => {
  try {
    const sql = await getSQLEngine();
    if (!fs.existsSync(DB_PATH)) { res.json({ highMatch: 0, streak: 0, totalApplied: 0 }); return; }
    const db = new sql.Database(fs.readFileSync(DB_PATH));

    const exec = (q: string) => {
      const r = db.exec(q);
      return r.length ? r[0].values : [];
    };

    const highMatch = (exec(`SELECT COUNT(*) FROM job_applications WHERE score_total >= 90 AND status IN ('queued','review')`)[0]?.[0] ?? 0) as number;
    const totalApplied = (exec(`SELECT COUNT(*) FROM job_applications WHERE status = 'applied'`)[0]?.[0] ?? 0) as number;

    // Streak: dias consecutivos com pelo menos 1 candidatura
    const dates = exec(`SELECT DISTINCT date(applied_at) as d FROM job_applications WHERE status='applied' AND applied_at IS NOT NULL ORDER BY d DESC`);
    let streak = 0;
    const today = new Date(); today.setHours(0,0,0,0);
    for (let i = 0; i < dates.length; i++) {
      const d = new Date(dates[i][0] as string); d.setHours(0,0,0,0);
      const expected = new Date(today); expected.setDate(today.getDate() - i);
      if (d.getTime() === expected.getTime()) streak++;
      else break;
    }

    db.close();
    res.json({ highMatch, streak, totalApplied });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/work/analytics/full ─────────────────────────────────────────────
// Analytics completo: keywords, skills map, rejection reasons, hire probability
app.get('/api/work/analytics/full', async (_req: Request, res: Response) => {
  try {
    const memory = await getMemory();
    const topKeywords = memory.getTopKeywords(20);
    const twin = twinStore.get();
    const mySkills = new Set([...twin.professional.stack, ...twin.professional.skills].map(s => s.toLowerCase()));

    // Skills map
    const skillsMap = topKeywords.map(kw => ({
      skill: kw.keyword,
      hasIt: mySkills.has(kw.keyword) || [...mySkills].some(s => s.includes(kw.keyword) || kw.keyword.includes(s)),
      marketDemand: kw.aparicoes,
      priority: kw.aparicoes > 10 ? 'alta' : kw.aparicoes > 4 ? 'media' : 'baixa',
    }));

    // Rejection reasons from reason_filter
    const sql = await getSQLEngine();
    const rejectionReasons: { category: string; count: number; examples: string[] }[] = [];
    if (fs.existsSync(DB_PATH)) {
      const db = new sql.Database(fs.readFileSync(DB_PATH));
      const rows = db.exec(`SELECT reason_filter FROM job_applications WHERE reason_filter IS NOT NULL AND status IN ('filtered_out','queued') LIMIT 100`);
      db.close();
      if (rows.length) {
        const cats: Record<string, string[]> = {
          'Stack/Tecnologia': [], 'Salário': [], 'Senioridade': [],
          'Localização': [], 'Idioma': [], 'Outro': [],
        };
        rows[0].values.forEach(([rf]) => {
          const s = String(rf).toLowerCase();
          if (s.includes('stack') || s.includes('tecnolog') || s.includes('linguagem') || s.includes('framework')) cats['Stack/Tecnologia'].push(String(rf));
          else if (s.includes('salário') || s.includes('remuner') || s.includes('faixa')) cats['Salário'].push(String(rf));
          else if (s.includes('senior') || s.includes('nível') || s.includes('junior') || s.includes('pleno')) cats['Senioridade'].push(String(rf));
          else if (s.includes('local') || s.includes('cidade') || s.includes('presenci')) cats['Localização'].push(String(rf));
          else if (s.includes('idiom') || s.includes('inglês') || s.includes('english')) cats['Idioma'].push(String(rf));
          else cats['Outro'].push(String(rf));
        });
        for (const [category, examples] of Object.entries(cats)) {
          if (examples.length) rejectionReasons.push({ category, count: examples.length, examples: examples.slice(0,2) });
        }
        rejectionReasons.sort((a, b) => b.count - a.count);
      }
    }

    // Hire probability (heuristic baseada em histórico)
    const companyInsights = memory.getTopCompanies(10);
    const avgResponseRate = companyInsights.length
      ? companyInsights.reduce((s, c) => s + c.taxaResposta, 0) / companyInsights.length
      : 0;
    const hireProbability = Math.min(95, Math.round(avgResponseRate * 100 * 3 + skillsMap.filter(s => s.hasIt).length * 1.5));

    res.json({ topKeywords, skillsMap, rejectionReasons, hireProbability });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/work/ats/:jobId ─────────────────────────────────────────────────
app.post('/api/work/ats/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) { res.status(400).json({ error: 'ANTHROPIC_API_KEY não configurada' }); return; }

    const sql = await getSQLEngine();
    if (!fs.existsSync(DB_PATH)) { res.status(404).json({ error: 'DB não encontrado' }); return; }
    const db = new sql.Database(fs.readFileSync(DB_PATH));
    const r  = db.exec(`SELECT job_title, description FROM job_applications WHERE id = ?`, [String(jobId)]);
    db.close();
    if (!r.length || !r[0].values.length) { res.status(404).json({ error: 'Vaga não encontrada' }); return; }

    const [jobTitle, description] = r[0].values[0] as [string, string];
    const agent  = new ATSAgent(twinStore, retriever, apiKey);
    const result = await agent.analyze(String(jobId), jobTitle, description ?? '');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/work/resume/:jobId ──────────────────────────────────────────────
app.post('/api/work/resume/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) { res.status(400).json({ error: 'ANTHROPIC_API_KEY não configurada' }); return; }

    const sql = await getSQLEngine();
    if (!fs.existsSync(DB_PATH)) { res.status(404).json({ error: 'DB não encontrado' }); return; }
    const db = new sql.Database(fs.readFileSync(DB_PATH));
    const r  = db.exec(`SELECT job_title, company, description FROM job_applications WHERE id = ?`, [String(jobId)]);
    db.close();
    if (!r.length || !r[0].values.length) { res.status(404).json({ error: 'Vaga não encontrada' }); return; }

    const [jobTitle, company, description] = r[0].values[0] as [string, string, string];
    const agent  = new ResumeAgent(twinStore, retriever, apiKey);
    const result = await agent.generate(String(jobId), jobTitle, company, description ?? '');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/work/interview/prepare ─────────────────────────────────────────
app.post('/api/work/interview/prepare', async (req: Request, res: Response) => {
  try {
    const { jobId, company, role, description } = req.body as { jobId: string; company: string; role: string; description: string };
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) { res.status(400).json({ error: 'ANTHROPIC_API_KEY não configurada' }); return; }

    const coach   = new InterviewCoach(twinStore, retriever, apiKey);
    const session = await coach.prepare(jobId ?? 'manual', company ?? '', role ?? '', description ?? '');
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/work/interview/feedback ────────────────────────────────────────
app.post('/api/work/interview/feedback', async (req: Request, res: Response) => {
  try {
    const { question, candidateAnswer, modelAnswer } = req.body as { question: string; candidateAnswer: string; modelAnswer: string };
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) { res.status(400).json({ error: 'ANTHROPIC_API_KEY não configurada' }); return; }

    const coach    = new InterviewCoach(twinStore, retriever, apiKey);
    const feedback = await coach.feedback(question, candidateAnswer, modelAnswer);
    res.json(feedback);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/work/salary ─────────────────────────────────────────────────────
app.post('/api/work/salary', async (req: Request, res: Response) => {
  try {
    const { jobTitle, company, description, jobId } = req.body as { jobTitle: string; company: string; description: string; jobId?: string };
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) { res.status(400).json({ error: 'ANTHROPIC_API_KEY não configurada' }); return; }

    const advisor = new SalaryAdvisor(twinStore, apiKey);
    const result  = await advisor.advise(jobTitle ?? '', company ?? '', description ?? '', jobId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/work/learning ────────────────────────────────────────────────────
app.get('/api/work/learning', async (_req: Request, res: Response) => {
  try {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    const memory = await getMemory();
    const agent  = new LearningAgent(twinStore, memory, apiKey);
    const roadmap = await agent.generateRoadmap();
    res.json(roadmap);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/work/networking/crm ──────────────────────────────────────────────
app.get('/api/work/networking/crm', async (req: Request, res: Response) => {
  try {
    const net = await getNetworking();
    const { status } = req.query as Record<string, string>;
    res.json(net.getRecruiters(status));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/work/networking/crm ─────────────────────────────────────────────
app.post('/api/work/networking/crm', async (req: Request, res: Response) => {
  try {
    const net     = await getNetworking();
    const contact = req.body as Parameters<typeof net.addRecruiter>[0];
    const result  = net.addRecruiter({
      ...contact,
      lastContact:  contact.lastContact || new Date().toISOString(),
      status:       contact.status || 'ativo',
      interactions: contact.interactions || [],
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── PATCH /api/work/networking/crm/:id ────────────────────────────────────────
app.patch('/api/work/networking/crm/:id', async (req: Request, res: Response) => {
  try {
    const net = await getNetworking();
    net.updateRecruiter(String(req.params.id), req.body as Parameters<typeof net.updateRecruiter>[1]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/work/networking/message ─────────────────────────────────────────
app.post('/api/work/networking/message', async (req: Request, res: Response) => {
  try {
    const { recruiterName, company, jobTitle } = req.body as { recruiterName: string; company: string; jobTitle: string };
    const net     = await getNetworking();
    const message = await net.generateConnectionMessage(recruiterName ?? '', company ?? '', jobTitle ?? '');
    res.json({ message });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/work/marketplace ─────────────────────────────────────────────────
app.get('/api/work/marketplace', async (_req: Request, res: Response) => {
  try {
    const reg = await getRegistry();
    res.json(reg.getCatalog());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/work/marketplace/:id/install ────────────────────────────────────
app.post('/api/work/marketplace/:id/install', async (req: Request, res: Response) => {
  try {
    const reg = await getRegistry();
    reg.install(String(req.params.id));
    res.json({ ok: true, installed: true });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// ── POST /api/work/marketplace/:id/uninstall ──────────────────────────────────
app.post('/api/work/marketplace/:id/uninstall', async (req: Request, res: Response) => {
  try {
    const reg = await getRegistry();
    reg.uninstall(String(req.params.id));
    res.json({ ok: true, installed: false });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// ── POST /api/work/marketplace/:id/toggle ─────────────────────────────────────
app.post('/api/work/marketplace/:id/toggle', async (req: Request, res: Response) => {
  try {
    const { enabled } = req.body as { enabled: boolean };
    const reg = await getRegistry();
    reg.toggle(String(req.params.id), !!enabled);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// ── POST /api/work/marketplace/:id/run ───────────────────────────────────────
// Executa um plugin específico com contexto fornecido pelo cliente
app.post('/api/work/marketplace/:id/run', async (req: Request, res: Response) => {
  try {
    const pluginId = String(req.params.id);
    const { jobId, input, intent } = req.body as { jobId?: string; input?: string; intent?: string };
    const apiKey = process.env['ANTHROPIC_API_KEY'];

    let jobTitle = '', company = '', description = '';
    if (jobId) {
      const sql = await getSQLEngine();
      if (fs.existsSync(DB_PATH)) {
        const db = new sql.Database(fs.readFileSync(DB_PATH));
        const r  = db.exec(`SELECT job_title, company, description FROM job_applications WHERE id = ?`, [jobId]);
        db.close();
        if (r.length && r[0].values.length) {
          [jobTitle, company, description] = r[0].values[0] as [string, string, string];
        }
      }
    }

    const reg    = await getRegistry();
    const result = await reg.executePlugin(pluginId, {
      twin: twinStore.get(),
      apiKey,
      input:           input ?? '',
      intent:          intent ?? 'HUNT',
      jobId,
      jobTitle,
      company,
      jobDescription:  description || (input ?? ''),
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/work/marketplace/run-for-intent ─────────────────────────────────
// Executa TODOS os plugins instalados que atendem a um intent
app.post('/api/work/marketplace/run-for-intent', async (req: Request, res: Response) => {
  try {
    const { intent, input, jobId } = req.body as { intent: string; input: string; jobId?: string };
    const apiKey = process.env['ANTHROPIC_API_KEY'];

    let jobTitle = '', company = '', description = '';
    if (jobId) {
      const sql = await getSQLEngine();
      if (fs.existsSync(DB_PATH)) {
        const db = new sql.Database(fs.readFileSync(DB_PATH));
        const r  = db.exec(`SELECT job_title, company, description FROM job_applications WHERE id = ?`, [jobId]);
        db.close();
        if (r.length && r[0].values.length) {
          [jobTitle, company, description] = r[0].values[0] as [string, string, string];
        }
      }
    }

    const reg     = await getRegistry();
    const results = await reg.executeForIntent(intent, {
      twin: twinStore.get(), apiKey, input, intent,
      jobId, jobTitle, company, jobDescription: description || input,
    });

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/work/state-stats ─────────────────────────────────────────────────
// Estados granulares da máquina de estados (confirmed, submitting, etc.)
app.get('/api/work/state-stats', async (_req: Request, res: Response) => {
  try {
    const stats = await withDb(db => {
      // Tenta coluna granular; cai no status legado se não existir
      try {
        const r = db.exec(
          `SELECT COALESCE(application_state, status) as s, COUNT(*) as c
           FROM job_applications GROUP BY COALESCE(application_state, status)`,
        );
        if (!r.length) return {};
        return Object.fromEntries(r[0].values.map(row => [row[0] as string, row[1] as number]));
      } catch {
        const r = db.exec(`SELECT status as s, COUNT(*) as c FROM job_applications GROUP BY status`);
        if (!r.length) return {};
        return Object.fromEntries(r[0].values.map(row => [row[0] as string, row[1] as number]));
      }
    });
    res.json(stats ?? {});
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/work/evidence/:jobId ─────────────────────────────────────────────
// Retorna manifest de evidências (screenshots, traces) de uma candidatura
app.get('/api/work/evidence/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const logsDir = path.resolve(process.cwd(), '.vraxia-work', 'logs', `application_${jobId}`);
    const manifestPath = path.join(logsDir, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      res.status(404).json({ error: 'Evidências não encontradas', jobId });
      return;
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    res.json({ jobId, logsDir, manifest });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/work/evidence/:jobId/health ─────────────────────────────────────
app.get('/api/work/evidence/:jobId/health', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const healthPath = path.resolve(process.cwd(), '.vraxia-work', 'logs', `application_${jobId}`, 'health-report.json');
    if (!fs.existsSync(healthPath)) { res.status(404).json({ error: 'Health report não encontrado', jobId }); return; }
    res.json(JSON.parse(fs.readFileSync(healthPath, 'utf-8')));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/work/evidence/:jobId/trace ───────────────────────────────────────
app.get('/api/work/evidence/:jobId/trace', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const tracePath = path.resolve(process.cwd(), '.vraxia-work', 'logs', `application_${jobId}`, 'trace.json');
    if (!fs.existsSync(tracePath)) { res.status(404).json({ error: 'Trace não encontrado' }); return; }
    res.json(JSON.parse(fs.readFileSync(tracePath, 'utf-8')));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/work/evidence/:jobId/truth ──────────────────────────────────────
// Retorna o TruthRecord (avaliação objetiva) de uma candidatura
app.get('/api/work/evidence/:jobId/truth', async (req: Request, res: Response) => {
  try {
    const jobId = String(req.params['jobId']);
    const truthPath = path.resolve(process.cwd(), '.vraxia-work', 'logs', `application_${jobId}`, 'truth-record.json');

    // Lê o application_state real do DB para não usar o default 'failed'
    const actualState = await withDb(db => {
      const r = db.exec(
        `SELECT COALESCE(application_state, status) FROM job_applications WHERE id = ?`,
        [jobId],
      );
      return (r[0]?.values?.[0]?.[0] as string) ?? 'failed';
    }) ?? 'failed';

    if (!fs.existsSync(truthPath)) {
      const evidenceDir = path.resolve(process.cwd(), '.vraxia-work', 'logs', `application_${jobId}`);
      if (fs.existsSync(evidenceDir)) {
        const { ApplicationTruthEngine } = await import('../application/ApplicationTruthEngine.js');
        const engineInst = new ApplicationTruthEngine();
        // Passa o estado real do workflow em vez do default 'failed'
        const truth = engineInst.evaluateFromDir(jobId, evidenceDir, actualState as import('../application/types.js').ApplicationState);
        res.json(truth);
        return;
      }
      res.status(404).json({ error: 'Truth record não encontrado', jobId });
      return;
    }

    // Normaliza valores de confidence gerados pelo schema antigo
    const record = JSON.parse(fs.readFileSync(truthPath, 'utf-8')) as Record<string, unknown>;
    if (record['confidence'] === 'FAILED')     record['confidence'] = 'REJECTED';
    if (record['confidence'] === 'CONFIRMED')  record['confidence'] = 'VERIFIED';
    res.json(record);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/work/truth-stats ─────────────────────────────────────────────────
// Métricas Truth Engine — evidências objetivas por candidatura.
//
// IMPORTANTE: todos os rates são retornados como FLOAT (ex: 1.22), não inteiros.
// O dashboard formata com toFixed(1) para evitar truncamento de taxas pequenas.
//
// Denominador correto: registros que passaram pelo fluxo de apply,
// NÃO todos os registros do banco.
app.get('/api/work/truth-stats', async (_req: Request, res: Response) => {
  try {
    const { ApplicationRepository } = await import('../application/ApplicationRepository.js');
    const repo = await ApplicationRepository.create();
    const stats = repo.getTruthStats();
    repo.close();

    // Platform breakdown (workflow-submitted per platform)
    const platformStats = await withDb(db => {
      const platformRows = db.exec(`
        SELECT COALESCE(platform, 'linkedin') as p,
               SUM(CASE WHEN application_state IN ('submitted','validating','confirmed') THEN 1 ELSE 0 END) as submitted,
               COUNT(*) as total
        FROM job_applications GROUP BY p
      `);
      const byPlatform: Record<string, { submitted: number; total: number; rate: number }> = {};
      if (platformRows.length) {
        for (const r of platformRows[0].values) {
          const p = r[0] as string;
          const s = (r[1] as number) ?? 0;
          const t = (r[2] as number) ?? 1;
          byPlatform[p] = {
            submitted: s,
            total: t,
            rate: t > 0 ? parseFloat(((s / t) * 100).toFixed(2)) : 0,
          };
        }
      }
      return byPlatform;
    });

    res.json({
      ...stats,
      byPlatform: platformStats ?? {},
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/work/workflow-stats ──────────────────────────────────────────────
// Estatísticas PURAS do workflow do robô — separadas do Truth Engine.
// Queued / Running / Submitted / Failed / Cancelled / Blocked
app.get('/api/work/workflow-stats', async (_req: Request, res: Response) => {
  try {
    const { ApplicationRepository } = await import('../application/ApplicationRepository.js');
    const repo = await ApplicationRepository.create();
    const stats = repo.getWorkflowStats();
    repo.close();
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/work/funnel ──────────────────────────────────────────────────────
// Funil de WORKFLOW — estados do robô de automação (discovered → hired).
//
// "submitted" agrupa todos os estados pós-submit do robô:
//   submitted + validating + confirmed (workflow OK)
//
// Este funil NÃO representa verificação objetiva — para isso use /truth-stats.
app.get('/api/work/funnel', async (_req: Request, res: Response) => {
  try {
    const funnel = await withDb(db => {
      const stateRows = db.exec(`
        SELECT COALESCE(application_state, status) as s, COUNT(*) as c
        FROM job_applications GROUP BY s
      `);

      const countByState: Record<string, number> = {};
      if (stateRows.length) {
        for (const r of stateRows[0].values) countByState[r[0] as string] = r[1] as number;
      }

      // Status legado → estado canônico
      const legacyMap: Record<string, string> = {
        scanned:      'discovered',
        applied:      'submitted',   // legado "applied" = workflow submeteu
        error:        'failed',
        applying:     'starting',
        filtered_out: 'cancelled',
        interview:    'interview',
      };
      for (const [legacy, canonical] of Object.entries(legacyMap)) {
        if (countByState[legacy]) {
          countByState[canonical] = (countByState[canonical] ?? 0) + (countByState[legacy] ?? 0);
          if (legacy !== canonical) delete countByState[legacy];
        }
      }

      // Agrupa estados intermediários de workflow bem-sucedido em "submitted"
      // (validating e confirmed são etapas internas do robô, não estados Truth)
      for (const s of ['validating', 'confirmed']) {
        if (countByState[s]) {
          countByState['submitted'] = (countByState['submitted'] ?? 0) + countByState[s];
          delete countByState[s];
        }
      }

      // Ordem de exibição no funil — da esquerda para direita (discovery → hired)
      const stateOrder = [
        'discovered', 'queued', 'starting', 'opening_job', 'opening_easy_apply',
        'uploading_resume', 'filling_questions', 'reviewing', 'submitting',
        'submitted',
        'already_applied', 'failed', 'cancelled', 'blocked', 'timeout',
        'rejected', 'interview', 'offer', 'hired',
      ];

      const totalAll = Object.values(countByState).reduce((s, c) => s + c, 0);

      return stateOrder
        .filter(s => (countByState[s] ?? 0) > 0)
        .map(s => ({
          state:      s,
          count:      countByState[s] ?? 0,
          pctOfTotal: totalAll > 0
            ? parseFloat(((countByState[s] ?? 0) / totalAll * 100).toFixed(1))
            : 0,
        }));
    });

    res.json({ funnel: funnel ?? [] });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/work/applications/:jobId/analytics ───────────────────────────────
// Analytics detalhado de uma candidatura: truth, health, timeline, errors
app.get('/api/work/applications/:jobId/analytics', async (req: Request, res: Response) => {
  try {
    const jobId = String(req.params['jobId']);
    const evidenceDir = path.resolve(process.cwd(), '.vraxia-work', 'logs', `application_${jobId}`);

    const appRow = await withDb(db => {
      const r = db.exec(`
        SELECT job_title, company, platform, status, application_state, confidence, validation_score,
               health_score, error_category, error_rca, trace_id, evidence_dir, applied_at,
               total_duration_ms, retry_count, reason_apply, reason_filter, score_total,
               validation_method, validation_confidence
        FROM job_applications WHERE id = ?
      `, [jobId]);
      if (!r.length || !r[0].values.length) return null;
      const cols = r[0].columns;
      return Object.fromEntries(cols.map((c, i) => [c, r[0].values[0][i]]));
    });

    if (!appRow) { res.status(404).json({ error: 'Candidatura não encontrada' }); return; }

    // Lê arquivos de evidência
    const readJsonFile = (filename: string) => {
      const p = path.join(evidenceDir, filename);
      if (!fs.existsSync(p)) return null;
      try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
    };

    const truth      = readJsonFile('truth-record.json');
    const health     = readJsonFile('health-report.json');
    const timeline   = readJsonFile('timeline.json');
    const trace      = readJsonFile('trace.json');
    const manifest   = readJsonFile('manifest.json');

    // Screenshots list
    const screenshots: string[] = [];
    if (fs.existsSync(evidenceDir)) {
      for (const f of fs.readdirSync(evidenceDir)) {
        if (f.endsWith('.png')) screenshots.push(f);
      }
    }

    res.json({
      jobId,
      application: appRow,
      truth,
      health,
      timeline,
      traceEventCount: (trace?.events ?? []).length,
      manifest,
      screenshots,
      evidenceDir,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── PATCH /api/work/applications/:jobId/lifecycle ─────────────────────────────
// Atualiza estado de ciclo de vida pós-apply (interview, offer, hired, rejected)
app.patch('/api/work/applications/:jobId/lifecycle', async (req: Request, res: Response) => {
  try {
    const jobId = String(req.params['jobId']);
    const { state, notes } = req.body as { state: string; notes?: string };

    const validLifecycleStates = ['interview', 'offer', 'hired', 'rejected'];
    if (!validLifecycleStates.includes(state)) {
      res.status(400).json({ error: `Estado inválido: ${state}. Válidos: ${validLifecycleStates.join(', ')}` });
      return;
    }

    const updated = await withDb(db => {
      const now = new Date().toISOString();
      // Mapa estado → status legado (confirmed removido — é estado de workflow, não lifecycle)
      const legacyStatus: Record<string, string> = {
        interview: 'interview', offer: 'applied', hired: 'applied',
        rejected: 'filtered_out',
      };
      db.run(`
        UPDATE job_applications SET
          application_state = ?,
          status            = ?,
          notes             = COALESCE(?, notes),
          updated_at        = ?
        WHERE id = ?
      `, [state, legacyStatus[state] ?? 'applied', notes ?? null, now, jobId]);
      const r = db.exec(`SELECT changes()`);
      return (r[0]?.values?.[0]?.[0] as number) ?? 0;
    });

    if (!updated) { res.status(404).json({ error: 'Candidatura não encontrada' }); return; }
    res.json({ ok: true, jobId, state, updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/work/opportunity-scores ─────────────────────────────────────────
// Career Decision Score: hire_scores JOIN job_applications.
// 5 dimensions computed server-side — frontend never calculates rules.
//   interviewProbability · atsProbability · technicalFit · opportunityQuality · roiScore
app.get('/api/work/opportunity-scores', async (req: Request, res: Response) => {
  try {
    const limit  = Math.min(parseInt(String(req.query['limit'] ?? '100'), 10), 500);
    const action = String(req.query['action'] ?? 'all'); // APPLY | REVIEW | SKIP | all

    const rows = await withDb(db => {
      let sql = `
        SELECT
          hs.job_id, hs.twin_id,
          hs.technical_fit, hs.salary_fit, hs.seniority_fit,
          hs.location_fit, hs.ats_probability, hs.historical_score,
          hs.competition_level, hs.publication_age_days,
          hs.interview_probability, hs.hire_score, hs.action,
          hs.reasoning, hs.key_strengths, hs.key_weaknesses,
          hs.ats_keywords_found, hs.ats_keywords_missing, hs.scored_at,
          ja.company, ja.job_title, ja.status, ja.platform,
          ja.linkedin_url, ja.applied_at, ja.updated_at
        FROM hire_scores hs
        JOIN job_applications ja ON hs.job_id = ja.id
        WHERE 1=1
      `;
      const params: (string | number)[] = [];
      if (action !== 'all') { sql += ` AND hs.action = ?`; params.push(action); }
      sql += ` ORDER BY hs.interview_probability DESC LIMIT ?`;
      params.push(limit);
      return dbQuery(db, sql, params);
    });

    const result = (rows ?? []).map(r => {
      const ip   = (r['interview_probability'] as number) ?? 0;
      const ats  = (r['ats_probability']       as number) ?? 0;
      const comp = (r['competition_level']     as string) ?? 'medium';
      const age  = (r['publication_age_days']  as number) ?? 3;

      const compAdj = comp === 'low' ? 20 : comp === 'medium' ? 0 : comp === 'high' ? -15 : -30;
      const ageAdj  = age < 1 ? 20 : age <= 3 ? 10 : age <= 7 ? 0 : age <= 14 ? -15 : -25;
      const opportunityQuality = Math.min(100, Math.max(0, Math.round(70 + compAdj + ageAdj)));
      const roiScore = Math.min(100, Math.max(0, Math.round(ip * 0.45 + ats * 0.25 + opportunityQuality * 0.30)));

      return {
        ...r,
        opportunityQuality,
        roiScore,
        platform:           detectPlatform(r),
        keyStrengths:       tryParseJson(r['key_strengths'],        [] as string[]),
        keyWeaknesses:      tryParseJson(r['key_weaknesses'],       [] as string[]),
        atsKeywordsFound:   tryParseJson(r['ats_keywords_found'],   [] as string[]),
        atsKeywordsMissing: tryParseJson(r['ats_keywords_missing'], [] as string[]),
      };
    });

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/work/career-intelligence ────────────────────────────────────────
// Aggregates learning_patterns for Career Intelligence page.
// Returns interview rates by twin / stack / platform / role, plus timing from hire_scores.
app.get('/api/work/career-intelligence', async (_req: Request, res: Response) => {
  const empty = { twins: [], stacks: [], platforms: [], roles: [], timing: [],
    summary: { totalApplied: 0, totalInterviews: 0, overallIR: 0 }, initialized: false };
  try {
    // Gracefully handle missing tables (tables created on first hunt run)
    const tableExists = await withDb(db => {
      try {
        dbQuery(db, `SELECT 1 FROM learning_patterns LIMIT 1`);
        return true;
      } catch { return false; }
    });
    if (!tableExists) { res.json(empty); return; }

    const patterns = await withDb(db => dbQuery(db, `
      SELECT pattern_type, pattern_key, total_applications, interviews,
             rejections, no_response, offers, interview_rate, avg_hire_score, last_updated
      FROM learning_patterns
      ORDER BY pattern_type, interview_rate DESC, total_applications DESC
    `)) ?? [];

    const byType: Record<string, typeof patterns> = { twin: [], stack: [], platform: [], role: [] };
    for (const r of patterns) {
      const t = r['pattern_type'] as string;
      if (byType[t]) byType[t].push(r);
    }

    // Timing buckets from hire_scores × interview_outcomes
    const timing = await withDb(db => {
      try {
        return dbQuery(db, `
          SELECT
            CASE
              WHEN hs.publication_age_days < 1   THEN '< 24h'
              WHEN hs.publication_age_days <= 3  THEN '1-3 dias'
              WHEN hs.publication_age_days <= 7  THEN '3-7 dias'
              WHEN hs.publication_age_days <= 14 THEN '1-2 semanas'
              ELSE '> 2 semanas'
            END AS bucket,
            COUNT(*) AS total,
            SUM(CASE WHEN io.outcome IN ('interview','offer','hired') THEN 1 ELSE 0 END) AS interviews,
            AVG(CASE WHEN io.outcome IN ('interview','offer','hired') THEN 100.0 ELSE 0 END) AS interview_rate,
            MIN(hs.publication_age_days) AS min_age
          FROM hire_scores hs
          LEFT JOIN interview_outcomes io ON hs.job_id = io.job_id
          WHERE hs.publication_age_days IS NOT NULL
          GROUP BY bucket
          ORDER BY min_age
        `);
      } catch { return []; }
    }) ?? [];

    const [totalApplied, totalInterviews] = await withDb(db => {
      const a = dbQuery(db, `SELECT COUNT(*) as c FROM job_applications WHERE status='applied'`);
      const i = (() => { try { return dbQuery(db, `SELECT COUNT(*) as c FROM interview_outcomes WHERE outcome IN ('interview','offer','hired')`); } catch { return [{c:0}]; } })();
      return [(a[0]?.['c'] as number) ?? 0, (i[0]?.['c'] as number) ?? 0];
    }) ?? [0, 0];

    const overallIR = totalApplied > 0 ? parseFloat(((totalInterviews / totalApplied) * 100).toFixed(1)) : 0;

    res.json({
      twins:     byType['twin']     ?? [],
      stacks:    byType['stack']    ?? [],
      platforms: byType['platform'] ?? [],
      roles:     byType['role']     ?? [],
      timing,
      summary: { totalApplied, totalInterviews, overallIR },
      initialized: true,
    });
  } catch (e) {
    res.json(empty); // never 500 — return empty so dashboard shows "run hunt first"
  }
});

// ── GET /api/work/decisions ───────────────────────────────────────────────────
// Gate decisions from decisions.jsonl (written by hunt.ts → persistDecision())
app.get('/api/work/decisions', (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query['limit'] ?? '100'), 10), 500);
    const decisionsPath = path.join(WORK_DIR, 'decisions.jsonl');
    if (!fs.existsSync(decisionsPath)) { res.json([]); return; }
    const all = fs.readFileSync(decisionsPath, 'utf-8')
      .trim().split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .reverse()
      .slice(0, limit);
    res.json(all);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/work/prediction-stats ────────────────────────────────────────────
// Prediction Validation: compares predicted IP vs actual outcomes.
// Prediction correct if (IP>=75 && got interview) or (IP<75 && no interview).
app.get('/api/work/prediction-stats', async (_req: Request, res: Response) => {
  const emptyResponse = {
    total: 0, correct: 0, falsePositives: 0, falseNegatives: 0, trueNegatives: 0,
    accuracy: 0, falsePositiveRate: 0, falseNegativeRate: 0,
    recent: [], buckets: [], initialized: false,
  };
  try {
    const tableExists = await withDb(db => {
      try { dbQuery(db, `SELECT 1 FROM interview_outcomes LIMIT 1`); return true; }
      catch { return false; }
    });
    if (!tableExists) { res.json(emptyResponse); return; }

    const outcomes = await withDb(db => dbQuery(db, `
      SELECT outcome, interview_probability_at_apply, hire_score_at_apply,
             response_time_days, twin_id, company, job_title, created_at
      FROM interview_outcomes
      WHERE outcome IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 200
    `)) ?? [];

    let correct = 0, falsePos = 0, falseNeg = 0, trueNeg = 0;
    for (const o of outcomes) {
      const ip = (o['interview_probability_at_apply'] as number) ?? 0;
      const got = ['interview', 'offer', 'hired'].includes(o['outcome'] as string);
      const pred = ip >= 75;
      if (pred && got) correct++;
      else if (pred && !got) falsePos++;
      else if (!pred && got) falseNeg++;
      else trueNeg++;
    }

    const total   = outcomes.length;
    const accuracy = total > 0 ? Math.round(((correct + trueNeg) / total) * 100) : 0;

    const recent = outcomes.slice(0, 15).map(o => ({
      company:             o['company'],
      jobTitle:            o['job_title'],
      twinId:              o['twin_id'],
      prediction:          Math.round((o['interview_probability_at_apply'] as number) ?? 0),
      outcome:             o['outcome'],
      gotInterview:        ['interview', 'offer', 'hired'].includes(o['outcome'] as string),
      predictedInterview:  ((o['interview_probability_at_apply'] as number) ?? 0) >= 75,
      responseTimeDays:    o['response_time_days'],
    }));

    // Avg IP per outcome bucket
    const buckets = [
      { range: '≥ 90%',  min: 90,  max: 101 },
      { range: '75-89%', min: 75,  max: 90 },
      { range: '50-74%', min: 50,  max: 75 },
      { range: '< 50%',  min: 0,   max: 50 },
    ].map(b => {
      const inBucket = outcomes.filter(o => {
        const ip = (o['interview_probability_at_apply'] as number) ?? 0;
        return ip >= b.min && ip < b.max;
      });
      const interviews = inBucket.filter(o => ['interview','offer','hired'].includes(o['outcome'] as string)).length;
      return {
        range:          b.range,
        count:          inBucket.length,
        interviews,
        actualIR:       inBucket.length > 0 ? Math.round((interviews / inBucket.length) * 100) : 0,
      };
    });

    res.json({
      total, correct, falsePositives: falsePos, falseNegatives: falseNeg, trueNegatives: trueNeg,
      accuracy,
      falsePositiveRate: total > 0 ? Math.round((falsePos / total) * 100) : 0,
      falseNegativeRate: total > 0 ? Math.round((falseNeg / total) * 100) : 0,
      recent,
      buckets,
      initialized: total > 0,
    });
  } catch (e) {
    res.json(emptyResponse); // never 500
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
