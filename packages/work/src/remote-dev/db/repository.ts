// packages/work/src/remote-dev/db/repository.ts
// Remote Dev Agent — Database Repository (sql.js, same work.db)

import fs from 'fs';
import path from 'path';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { randomUUID, createHmac } from 'crypto';
import { RDA_SCHEMA, SEED_EXECUTORS } from './schema.js';
import type {
  RdaJob, JobEvent, JobStatus, JobEventType, Device,
  DeviceStatus, ExecutorInfo, JobMetrics, CreateJobRequest,
} from '../types/index.js';

const WORK_DIR = path.resolve(process.cwd(), '.vraxia-work');
const DB_PATH  = path.join(WORK_DIR, 'work.db');

let _SQL: SqlJsStatic | null = null;
async function getEngine(): Promise<SqlJsStatic> {
  if (!_SQL) _SQL = await initSqlJs();
  return _SQL;
}

// Opens DB, runs fn (which may write), persists file, closes.
async function withWriteDb<T>(fn: (db: Database) => T): Promise<T> {
  const engine = await getEngine();
  const buf    = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : undefined;
  const db     = buf ? new engine.Database(buf) : new engine.Database();
  try {
    const result = fn(db);
    fs.mkdirSync(WORK_DIR, { recursive: true });
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
    return result;
  } finally {
    db.close();
  }
}

async function withReadDb<T>(fn: (db: Database) => T): Promise<T | null> {
  if (!fs.existsSync(DB_PATH)) return null;
  const engine = await getEngine();
  const buf    = fs.readFileSync(DB_PATH);
  const db     = new engine.Database(buf);
  try { return fn(db); } finally { db.close(); }
}

function rows(db: Database, sql: string, params: (string | number | null)[] = []): Record<string, unknown>[] {
  const res = db.exec(sql, params);
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

function hashToken(token: string): string {
  return createHmac('sha256', process.env.RDA_SECRET ?? 'vraxia-rda-secret').update(token).digest('hex');
}

// ── Initialization ──────────────────────────────────────────────────────────

export async function initRdaSchema(): Promise<void> {
  await withWriteDb(db => {
    db.run(RDA_SCHEMA);
    db.run(SEED_EXECUTORS);
  });
}

// ── Devices ─────────────────────────────────────────────────────────────────

export async function registerDevice(name: string, platform: string, hostname: string, nodeVersion: string): Promise<{ device: Device; token: string }> {
  const id    = randomUUID();
  const token = randomUUID() + '-' + randomUUID();
  const hash  = hashToken(token);

  await withWriteDb(db => {
    db.run(
      `INSERT INTO rda_devices (id, name, platform, hostname, node_version, status, registered_at, last_seen_at, token_hash)
       VALUES (?,?,?,?,?,'offline',datetime('now'),datetime('now'),?)`,
      [id, name, platform, hostname, nodeVersion, hash],
    );
  });

  const device: Device = {
    id, name, platform, hostname, nodeVersion,
    status: 'offline', token: hash,
    registeredAt: new Date().toISOString(),
    lastSeenAt:   new Date().toISOString(),
  };
  return { device, token };
}

export async function authenticateDevice(token: string): Promise<Device | null> {
  const hash = hashToken(token);
  return withReadDb(db => {
    const found = rows(db, `SELECT * FROM rda_devices WHERE token_hash = ?`, [hash]);
    if (!found.length) return null;
    const r = found[0];
    return {
      id: r['id'] as string, name: r['name'] as string,
      platform: r['platform'] as string, hostname: r['hostname'] as string,
      nodeVersion: r['node_version'] as string, status: r['status'] as DeviceStatus,
      token: r['token_hash'] as string,
      registeredAt: r['registered_at'] as string, lastSeenAt: r['last_seen_at'] as string,
    };
  });
}

export async function updateDeviceStatus(deviceId: string, status: DeviceStatus, workspaceJson?: string): Promise<void> {
  await withWriteDb(db => {
    db.run(
      `UPDATE rda_devices SET status=?, last_seen_at=datetime('now')${workspaceJson ? ', workspace_json=?' : ''} WHERE id=?`,
      workspaceJson ? [status, workspaceJson, deviceId] : [status, deviceId],
    );
  });
}

export async function listDevices(): Promise<Device[]> {
  return (await withReadDb(db =>
    rows(db, `SELECT * FROM rda_devices ORDER BY last_seen_at DESC`).map(r => ({
      id: r['id'] as string, name: r['name'] as string,
      platform: r['platform'] as string, hostname: r['hostname'] as string,
      nodeVersion: r['node_version'] as string, status: r['status'] as DeviceStatus,
      token: r['token_hash'] as string,
      registeredAt: r['registered_at'] as string, lastSeenAt: r['last_seen_at'] as string,
    }))
  )) ?? [];
}

// ── Jobs ────────────────────────────────────────────────────────────────────

export async function createJob(req: CreateJobRequest): Promise<RdaJob> {
  const id = randomUUID();
  const job: RdaJob = {
    id,
    deviceId:    req.deviceId,
    executorId:  req.executorId,
    projectPath: req.projectPath,
    mode:        req.mode,
    prompt:      req.prompt,
    permissions: req.permissions,
    status:      'queued',
    createdAt:   new Date().toISOString(),
  };

  await withWriteDb(db => {
    db.run(
      `INSERT INTO rda_jobs (id, device_id, executor_id, project_path, mode, prompt, permissions, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, req.deviceId, req.executorId, req.projectPath, req.mode,
       req.prompt, JSON.stringify(req.permissions), 'queued', job.createdAt],
    );
  });

  return job;
}

export async function getJob(jobId: string): Promise<RdaJob | null> {
  return withReadDb(db => {
    const found = rows(db, `SELECT * FROM rda_jobs WHERE id = ?`, [jobId]);
    if (!found.length) return null;
    return mapJob(found[0]);
  });
}

export async function listJobs(deviceId?: string, limit = 50): Promise<RdaJob[]> {
  return (await withReadDb(db => {
    const sql = deviceId
      ? `SELECT * FROM rda_jobs WHERE device_id = ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT * FROM rda_jobs ORDER BY created_at DESC LIMIT ?`;
    const params = deviceId ? [deviceId, limit] : [limit];
    return rows(db, sql, params).map(mapJob);
  })) ?? [];
}

export async function updateJobStatus(jobId: string, status: JobStatus, errorMsg?: string): Promise<void> {
  const now = new Date().toISOString();
  await withWriteDb(db => {
    const cols: string[] = [`status=?`];
    const vals: (string | null)[] = [status];
    if (status === 'preparing' || status === 'analyzing') { cols.push(`started_at=?`); vals.push(now); }
    if (['completed', 'error', 'cancelled'].includes(status)) { cols.push(`completed_at=?`); vals.push(now); }
    if (errorMsg) { cols.push(`error_msg=?`); vals.push(errorMsg); }
    vals.push(jobId);
    db.run(`UPDATE rda_jobs SET ${cols.join(', ')} WHERE id=?`, vals);
  });
}

function mapJob(r: Record<string, unknown>): RdaJob {
  return {
    id:          r['id'] as string,
    deviceId:    r['device_id'] as string,
    executorId:  r['executor_id'] as string,
    projectPath: r['project_path'] as string,
    mode:        (r['mode'] as RdaJob['mode']) ?? 'code',
    prompt:      r['prompt'] as string,
    permissions: JSON.parse((r['permissions'] as string) || '{}'),
    status:      r['status'] as JobStatus,
    createdAt:   r['created_at'] as string,
    startedAt:   r['started_at'] as string | undefined,
    completedAt: r['completed_at'] as string | undefined,
    errorMsg:    r['error_msg'] as string | undefined,
  };
}

// ── Job Events ──────────────────────────────────────────────────────────────

export async function addJobEvent(jobId: string, type: JobEventType, payload: unknown): Promise<JobEvent> {
  const id  = randomUUID();
  const now = new Date().toISOString();
  await withWriteDb(db => {
    db.run(
      `INSERT INTO rda_job_events (id, job_id, type, payload, created_at) VALUES (?,?,?,?,?)`,
      [id, jobId, type, JSON.stringify(payload), now],
    );
  });
  return { id, jobId, type, payload: JSON.stringify(payload), createdAt: now };
}

export async function getJobEvents(jobId: string, afterId?: string): Promise<JobEvent[]> {
  return (await withReadDb(db => {
    const sql = afterId
      ? `SELECT * FROM rda_job_events WHERE job_id=? AND rowid > (SELECT rowid FROM rda_job_events WHERE id=?) ORDER BY created_at ASC`
      : `SELECT * FROM rda_job_events WHERE job_id=? ORDER BY created_at ASC`;
    return rows(db, sql, afterId ? [jobId, afterId] : [jobId]).map(r => ({
      id: r['id'] as string, jobId: r['job_id'] as string,
      type: r['type'] as JobEventType, payload: r['payload'] as string,
      createdAt: r['created_at'] as string,
    }));
  })) ?? [];
}

// ── Executors ───────────────────────────────────────────────────────────────

export async function listExecutors(): Promise<ExecutorInfo[]> {
  return (await withReadDb(db =>
    rows(db, `SELECT * FROM rda_executors ORDER BY name`).map(r => ({
      id:          r['id'] as ExecutorInfo['id'],
      name:        r['name'] as string,
      description: r['description'] as string,
      available:   Boolean(r['available']),
      version:     r['version'] as string | undefined,
    }))
  )) ?? [];
}

// ── Metrics ─────────────────────────────────────────────────────────────────

export async function saveMetrics(m: Omit<JobMetrics, 'sampledAt'>): Promise<void> {
  await withWriteDb(db => {
    db.run(
      `INSERT INTO rda_metrics (id, job_id, cpu_pct, ram_mb, tokens_used, files_changed, tests_run, tests_passed, commits, duration_ms, sampled_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
      [randomUUID(), m.jobId, m.cpuPct, m.ramMb, m.tokensUsed,
       m.filesChanged, m.testsRun, m.testsPassed, m.commits, m.durationMs],
    );
  });
}

export async function getMetrics(jobId: string): Promise<JobMetrics[]> {
  return (await withReadDb(db =>
    rows(db, `SELECT * FROM rda_metrics WHERE job_id=? ORDER BY sampled_at`, [jobId]).map(r => ({
      jobId:        r['job_id'] as string,
      cpuPct:       r['cpu_pct'] as number,
      ramMb:        r['ram_mb'] as number,
      tokensUsed:   r['tokens_used'] as number,
      filesChanged: r['files_changed'] as number,
      testsRun:     r['tests_run'] as number,
      testsPassed:  r['tests_passed'] as number,
      commits:      r['commits'] as number,
      durationMs:   r['duration_ms'] as number,
      sampledAt:    r['sampled_at'] as string,
    }))
  )) ?? [];
}

// ── Audit ───────────────────────────────────────────────────────────────────

export async function audit(deviceId: string | null, jobId: string | null, action: string, detail?: string, ip?: string): Promise<void> {
  await withWriteDb(db => {
    db.run(
      `INSERT INTO rda_audit (id, device_id, job_id, action, detail, ip, created_at) VALUES (?,?,?,?,?,?,datetime('now'))`,
      [randomUUID(), deviceId, jobId, action, detail ?? null, ip ?? null],
    );
  });
}
