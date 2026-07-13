// packages/work/src/application/ApplicationRepository.ts
// Repositório principal: tabela job_applications + application_attempts.
//
// IMPORTANTE — dois mundos separados:
//   Workflow Status  → application_state (estado da automação do robô)
//   Truth Status     → confidence (avaliação objetiva de evidências)
//
// Nunca somar ou combinar os dois para calcular métricas.

import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { ApplicationState, ApplicationAttempt, TruthStatus, TERMINAL_STATES } from './types.js';
import { Job, ApplicationStatus, JobScore, JobApplication } from '../types/index.js';

const DB_DIR  = path.resolve(process.cwd(), '.vraxia-work');
const DB_PATH = path.join(DB_DIR, 'work.db');

// Estados de workflow que representam "tentativa de candidatura iniciada"
// (excluem discovered/queued/already_applied que nunca chegaram ao apply)
const WORKFLOW_ATTEMPTED_STATES: ApplicationState[] = [
  'starting', 'opening_job', 'opening_easy_apply', 'uploading_resume',
  'filling_questions', 'reviewing', 'submitting', 'submitted', 'validating',
  'confirmed', 'failed', 'blocked', 'timeout', 'retrying',
];

// Estados de workflow que representam "robô terminou o fluxo apply com sucesso"
const WORKFLOW_SUBMITTED_STATES: ApplicationState[] = [
  'submitted', 'validating', 'confirmed',
];

// Mapeia ApplicationState → ApplicationStatus legado (dashboard + compat)
function toLegacy(state: ApplicationState): ApplicationStatus {
  switch (state) {
    case 'confirmed':
    case 'offer':
    case 'hired':              return 'applied';
    case 'interview':          return 'interview';
    case 'rejected':
    case 'failed':
    case 'cancelled':
    case 'blocked':
    case 'already_applied':    return 'filtered_out';
    case 'timeout':            return 'error';
    case 'discovered':
    case 'queued':             return 'queued';
    case 'starting':
    case 'opening_job':
    case 'opening_easy_apply':
    case 'uploading_resume':
    case 'filling_questions':
    case 'reviewing':
    case 'submitting':
    case 'submitted':
    case 'validating':
    case 'retrying':           return 'applying';
    default:                   return 'error';
  }
}

export class ApplicationRepository {
  private db!: Database;
  private SQL!: SqlJsStatic;

  static async create(): Promise<ApplicationRepository> {
    const r = new ApplicationRepository();
    await r.init();
    return r;
  }

  private async init(): Promise<void> {
    fs.mkdirSync(DB_DIR, { recursive: true });
    this.SQL = await initSqlJs();
    this.db = fs.existsSync(DB_PATH)
      ? new this.SQL.Database(fs.readFileSync(DB_PATH))
      : new this.SQL.Database();
    this.migrate();
  }

  private save(): void {
    fs.writeFileSync(DB_PATH, Buffer.from(this.db.export()));
  }

  private migrate(): void {
    // Tabela principal
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
        notes TEXT,
        platform TEXT DEFAULT 'linkedin'
      )
    `);

    // Colunas extras — idempotente via try/catch
    const addCol = (col: string, def: string) => {
      try { this.db.run(`ALTER TABLE job_applications ADD COLUMN ${col} ${def}`); } catch { /* já existe */ }
    };
    addCol('application_state TEXT',      "DEFAULT 'queued'");
    addCol('trace_id TEXT',               'DEFAULT NULL');
    addCol('evidence_dir TEXT',           'DEFAULT NULL');
    addCol('validation_method TEXT',      'DEFAULT NULL');
    addCol('validation_confidence TEXT',  'DEFAULT NULL');
    addCol('total_duration_ms INTEGER',   'DEFAULT 0');
    addCol('retry_count INTEGER',         'DEFAULT 0');
    addCol('reason_apply TEXT',           'DEFAULT NULL');
    addCol('reason_score TEXT',           'DEFAULT NULL');
    addCol('reason_filter TEXT',          'DEFAULT NULL');
    // Truth Engine
    addCol('confidence TEXT',             "DEFAULT 'UNKNOWN'");
    addCol('validation_score INTEGER',    'DEFAULT 0');
    addCol('proofs_json TEXT',            'DEFAULT NULL');
    addCol('error_category TEXT',         'DEFAULT NULL');
    addCol('error_rca TEXT',              'DEFAULT NULL');
    addCol('health_score INTEGER',        'DEFAULT 0');
    addCol('truth_evaluated_at TEXT',     'DEFAULT NULL');

    // Tabela de tentativas
    this.db.run(`
      CREATE TABLE IF NOT EXISTS application_attempts (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL,
        attempt_number INTEGER NOT NULL DEFAULT 1,
        state TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        selector TEXT,
        url TEXT,
        error TEXT,
        stack TEXT,
        screenshot_path TEXT,
        html_path TEXT,
        trace_id TEXT NOT NULL,
        retry_of TEXT,
        FOREIGN KEY (application_id) REFERENCES job_applications(id)
      )
    `);

    // Cache de scoring
    this.db.run(`
      CREATE TABLE IF NOT EXISTS score_cache (
        job_id    TEXT PRIMARY KEY,
        scored_at TEXT NOT NULL,
        score_json TEXT NOT NULL
      )
    `);

    // Índices
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_status      ON job_applications(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_state       ON job_applications(application_state)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_confidence  ON job_applications(confidence)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_company     ON job_applications(company)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_att_app     ON application_attempts(application_id)`);

    // ── Migrações de dados ─────────────────────────────────────────────────

    // Espelha status legado → application_state para registros antigos
    this.db.run(`
      UPDATE job_applications SET application_state = CASE status
        WHEN 'applied'      THEN 'confirmed'
        WHEN 'error'        THEN 'failed'
        WHEN 'filtered_out' THEN 'cancelled'
        WHEN 'rejected'     THEN 'failed'
        WHEN 'interview'    THEN 'confirmed'
        WHEN 'applying'     THEN 'starting'
        ELSE status
      END
      WHERE application_state = 'queued' AND status != 'queued'
    `);

    // Renomeia confidence values antigos para a nova terminologia
    // CONFIRMED → VERIFIED (agora é evidência objetiva, não estado de workflow)
    this.db.run(`UPDATE job_applications SET confidence = 'VERIFIED'  WHERE confidence = 'CONFIRMED'`);
    // FAILED → REJECTED (evita confusão com workflow failed)
    this.db.run(`UPDATE job_applications SET confidence = 'REJECTED'  WHERE confidence = 'FAILED'`);

    this.save();
  }

  // ── Upsert principal ───────────────────────────────────────────────────────

  upsert(app: JobApplication & { state?: ApplicationState }): void {
    const state: ApplicationState = app.state ?? 'queued';
    this.db.run(`
      INSERT INTO job_applications (
        id, job_title, company, location, linkedin_url, description,
        is_easy_apply, status, application_state, score_total, score_action,
        score_reason, questionnaire_answers, scanned_at, applied_at,
        updated_at, notes, platform
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        application_state = excluded.application_state,
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
      (app.job.description ?? '').slice(0, 2000),
      app.job.isEasyApply ? 1 : 0,
      toLegacy(state),
      state,
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

  // ── Atualiza estado granular ───────────────────────────────────────────────

  updateState(jobId: string, state: ApplicationState, meta?: {
    notes?: string;
    traceId?: string;
    evidenceDir?: string;
    validationMethod?: string;
    validationConfidence?: string;
    totalDurationMs?: number;
    retryCount?: number;
    reasonApply?: string;
    reasonScore?: string;
    reasonFilter?: string;
  }): void {
    const now = new Date().toISOString();
    this.db.run(`
      UPDATE job_applications SET
        status                = ?,
        application_state     = ?,
        updated_at            = ?,
        notes                 = COALESCE(?, notes),
        trace_id              = COALESCE(?, trace_id),
        evidence_dir          = COALESCE(?, evidence_dir),
        validation_method     = COALESCE(?, validation_method),
        validation_confidence = COALESCE(?, validation_confidence),
        total_duration_ms     = COALESCE(?, total_duration_ms),
        retry_count           = COALESCE(?, retry_count),
        reason_apply          = COALESCE(?, reason_apply),
        reason_score          = COALESCE(?, reason_score),
        reason_filter         = COALESCE(?, reason_filter),
        applied_at = CASE WHEN ? = 'confirmed' THEN ? ELSE applied_at END
      WHERE id = ?
    `, [
      toLegacy(state), state, now,
      meta?.notes ?? null,
      meta?.traceId ?? null,
      meta?.evidenceDir ?? null,
      meta?.validationMethod ?? null,
      meta?.validationConfidence ?? null,
      meta?.totalDurationMs ?? null,
      meta?.retryCount ?? null,
      meta?.reasonApply ?? null,
      meta?.reasonScore ?? null,
      meta?.reasonFilter ?? null,
      state, now,
      jobId,
    ]);
    this.save();
  }

  // ── Compat: StatusTracker.updateStatus ────────────────────────────────────

  updateStatus(jobId: string, status: ApplicationStatus, notes?: string): void {
    const stateMap: Record<ApplicationStatus, ApplicationState> = {
      scanned:              'queued',
      filtered_out:         'cancelled',
      queued:               'queued',
      applying:             'starting',
      applied:              'confirmed',
      questionnaire_pending:'filling_questions',
      questionnaire_done:   'submitted',
      rejected:             'failed',
      interview:            'confirmed',
      error:                'failed',
    };
    this.updateState(jobId, stateMap[status] ?? 'failed', { notes });
  }

  // ── Tentativas ─────────────────────────────────────────────────────────────

  insertAttempt(attempt: ApplicationAttempt): void {
    this.db.run(`
      INSERT INTO application_attempts (
        id, application_id, attempt_number, state,
        started_at, finished_at, duration_ms, selector, url,
        error, stack, screenshot_path, html_path, trace_id, retry_of
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      attempt.id,
      attempt.applicationId,
      attempt.attemptNumber,
      attempt.state,
      attempt.startedAt,
      attempt.finishedAt ?? null,
      attempt.durationMs ?? null,
      attempt.selector ?? null,
      attempt.url ?? null,
      attempt.error ?? null,
      attempt.stack ?? null,
      attempt.screenshotPath ?? null,
      attempt.htmlPath ?? null,
      attempt.traceId,
      attempt.retryOf ?? null,
    ]);
    this.save();
  }

  // ── Explainability ─────────────────────────────────────────────────────────

  saveExplainability(jobId: string, reasonApply?: string, reasonScore?: string, reasonFilter?: string): void {
    this.db.run(`
      UPDATE job_applications SET
        reason_apply  = COALESCE(?, reason_apply),
        reason_score  = COALESCE(?, reason_score),
        reason_filter = COALESCE(?, reason_filter)
      WHERE id = ?
    `, [reasonApply ?? null, reasonScore ?? null, reasonFilter ?? null, jobId]);
    this.save();
  }

  // ── Score cache ────────────────────────────────────────────────────────────

  getCachedScore(jobId: string, maxAgeDays = 5): import('../types/index.js').MatchScore | null {
    const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
    const res = this.db.exec(
      `SELECT score_json FROM score_cache WHERE job_id = ? AND scored_at >= ?`,
      [jobId, cutoff],
    );
    if (!res.length || !res[0].values.length) return null;
    try {
      return JSON.parse(res[0].values[0][0] as string) as import('../types/index.js').MatchScore;
    } catch { return null; }
  }

  cacheScore(jobId: string, score: import('../types/index.js').MatchScore): void {
    if (score.dealBreaker && score.total === 0) return;
    this.db.run(
      `INSERT INTO score_cache (job_id, scored_at, score_json)
       VALUES (?, ?, ?)
       ON CONFLICT(job_id) DO UPDATE SET scored_at = excluded.scored_at, score_json = excluded.score_json`,
      [jobId, new Date().toISOString(), JSON.stringify(score)],
    );
    this.save();
  }

  // ── Truth Engine ──────────────────────────────────────────────────────────

  saveTruth(jobId: string, truth: import('./types.js').TruthRecord, healthScore?: number): void {
    this.db.run(`
      UPDATE job_applications SET
        confidence           = ?,
        validation_score     = ?,
        proofs_json          = ?,
        health_score         = COALESCE(?, health_score),
        truth_evaluated_at   = ?,
        updated_at           = ?
      WHERE id = ?
    `, [
      truth.confidence,
      truth.validationScore,
      JSON.stringify(truth.proofs),
      healthScore ?? null,
      truth.evaluatedAt,
      new Date().toISOString(),
      jobId,
    ]);
    this.save();
  }

  saveError(jobId: string, error: import('./types.js').ApplicationError): void {
    this.db.run(`
      UPDATE job_applications SET
        error_category = ?,
        error_rca      = ?,
        updated_at     = ?
      WHERE id = ?
    `, [
      error.category,
      `${error.rca} | Recomendação: ${error.recommendation}`.slice(0, 500),
      new Date().toISOString(),
      jobId,
    ]);
    this.save();
  }

  /**
   * Retorna estatísticas do Truth Engine (auditoria de evidências).
   *
   * Denominador correto: registros que passaram pelo fluxo de apply
   * (application_state IN WORKFLOW_ATTEMPTED_STATES), não todos os registros.
   *
   * Taxas retornadas como FLOAT (ex: 1.22), nunca truncadas com Math.round().
   * O frontend é responsável por formatar com toFixed(1) ou toFixed(2).
   */
  getTruthStats(): {
    total: number;              // registros que passaram pelo fluxo de apply
    verified: number;           // confidence = VERIFIED (evidência hard)
    probable: number;           // confidence = PROBABLE (evidências parciais)
    rejected: number;           // confidence = REJECTED (evidência de falha)
    unknown: number;            // confidence = UNKNOWN (não avaliado)
    pending: number;            // alias de unknown — para exibição no dashboard
    pendingVerification: number; // workflow OK mas truth UNKNOWN
    truthRate: number;          // verified/total × 100 — float, ex: 1.22
    portalConfirmationRate: number; // via rede/portal — float
    myJobsConfirmationRate: number; // via My Jobs — float
    avgHealthScore: number;
    avgValidationScore: number;
    byErrorCategory: Record<string, number>;
    proofTypeSummary: Record<string, number>;
  } {
    const attemptedStates = WORKFLOW_ATTEMPTED_STATES.map(() => '?').join(',');
    const submittedStates = WORKFLOW_SUBMITTED_STATES.map(() => '?').join(',');

    const res = this.db.exec(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN confidence = 'VERIFIED'  THEN 1 ELSE 0 END) as verified,
        SUM(CASE WHEN confidence = 'PROBABLE'  THEN 1 ELSE 0 END) as probable,
        SUM(CASE WHEN confidence = 'REJECTED'  THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN confidence = 'UNKNOWN' OR confidence IS NULL THEN 1 ELSE 0 END) as unknown_c,
        SUM(CASE WHEN application_state IN (${submittedStates})
                  AND (confidence = 'UNKNOWN' OR confidence IS NULL)
                  THEN 1 ELSE 0 END) as pending_verification,
        ROUND(AVG(CASE WHEN health_score > 0 THEN CAST(health_score AS REAL) END), 2) as avg_health,
        ROUND(AVG(CASE WHEN validation_score > 0 THEN CAST(validation_score AS REAL) END), 2) as avg_valscore,
        SUM(CASE WHEN validation_method = 'network_response' THEN 1 ELSE 0 END) as portal_confirmed,
        SUM(CASE WHEN validation_method = 'my_jobs_applied'  THEN 1 ELSE 0 END) as myjobs_confirmed
       FROM job_applications
       WHERE application_state IN (${attemptedStates})`,
      // ATENÇÃO: a ordem dos parâmetros deve seguir a ordem dos ? no SQL.
      // submittedStates aparece primeiro (no CASE), attemptedStates no WHERE.
      [...WORKFLOW_SUBMITTED_STATES, ...WORKFLOW_ATTEMPTED_STATES],
    );

    const row = res[0]?.values?.[0] ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const total               = (row[0] as number) ?? 0;
    const verified            = (row[1] as number) ?? 0;
    const probable            = (row[2] as number) ?? 0;
    const rejected            = (row[3] as number) ?? 0;
    const unknown_c           = (row[4] as number) ?? 0;
    const pendingVerification = (row[5] as number) ?? 0;
    const avgHealth           = (row[6] as number) ?? 0;
    const avgValScore         = (row[7] as number) ?? 0;
    const portalConf          = (row[8] as number) ?? 0;
    const myJobsConf          = (row[9] as number) ?? 0;

    // Taxas como float puro — SEM Math.round aqui. Frontend formata.
    const truthRate               = total > 0 ? (verified            / total) * 100 : 0;
    const portalConfirmationRate  = total > 0 ? (portalConf          / total) * 100 : 0;
    const myJobsConfirmationRate  = total > 0 ? (myJobsConf          / total) * 100 : 0;

    const errRes = this.db.exec(
      `SELECT error_category, COUNT(*) as cnt FROM job_applications
       WHERE error_category IS NOT NULL GROUP BY error_category ORDER BY cnt DESC`
    );
    const byErrorCategory: Record<string, number> = {};
    if (errRes.length) {
      for (const r of errRes[0].values) {
        byErrorCategory[r[0] as string] = r[1] as number;
      }
    }

    // Proof type summary: conta quantas candidaturas têm cada tipo de prova
    const proofRows = this.db.exec(`SELECT proofs_json FROM job_applications WHERE proofs_json IS NOT NULL`);
    const proofTypeSummary: Record<string, number> = {};
    if (proofRows.length) {
      for (const r of proofRows[0].values) {
        try {
          const proofs = JSON.parse(r[0] as string) as Array<{ type: string }>;
          for (const p of proofs) proofTypeSummary[p.type] = (proofTypeSummary[p.type] ?? 0) + 1;
        } catch { /* skip malformed */ }
      }
    }

    return {
      total,
      verified,
      probable,
      rejected,
      unknown: unknown_c,
      pending: unknown_c,   // alias de unknown — para exibição no dashboard
      pendingVerification,
      truthRate,
      portalConfirmationRate,
      myJobsConfirmationRate,
      avgHealthScore:     avgHealth,
      avgValidationScore: avgValScore,
      byErrorCategory,
      proofTypeSummary,
    };
  }

  /**
   * Retorna estatísticas puras do Workflow (estados do robô).
   * Separado completamente do Truth Engine.
   */
  getWorkflowStats(): {
    queued: number;
    running: number;
    submitted: number;
    failed: number;
    cancelled: number;
    blocked: number;
    total: number;
    byState: Record<string, number>;
  } {
    const res = this.db.exec(
      `SELECT application_state, COUNT(*) as cnt FROM job_applications GROUP BY application_state`
    );

    const byState: Record<string, number> = {};
    if (res.length) {
      for (const row of res[0].values) {
        byState[row[0] as string] = row[1] as number;
      }
    }

    const queued = (byState['queued'] ?? 0) + (byState['discovered'] ?? 0);
    const running = ['starting', 'opening_job', 'opening_easy_apply', 'uploading_resume',
                     'filling_questions', 'reviewing', 'submitting', 'retrying']
      .reduce((s, k) => s + (byState[k] ?? 0), 0);
    const submitted = ['submitted', 'validating', 'confirmed']
      .reduce((s, k) => s + (byState[k] ?? 0), 0);
    const failed    = (byState['failed'] ?? 0) + (byState['timeout'] ?? 0);
    const cancelled = (byState['cancelled'] ?? 0) + (byState['already_applied'] ?? 0);
    const blocked   = byState['blocked'] ?? 0;
    const total     = Object.values(byState).reduce((s, v) => s + v, 0);

    return { queued, running, submitted, failed, cancelled, blocked, total, byState };
  }

  /** Retorna dados de funil completo (discovery → hired). */
  getFunnelStats(): Record<string, number> {
    const res = this.db.exec(
      `SELECT application_state, COUNT(*) as cnt FROM job_applications GROUP BY application_state`
    );
    const funnel: Record<string, number> = {};
    if (res.length) {
      for (const row of res[0].values) {
        funnel[row[0] as string] = row[1] as number;
      }
    }
    return funnel;
  }

  // ── Consultas ─────────────────────────────────────────────────────────────

  alreadyApplied(jobId: string): boolean {
    const res = this.db.exec(
      `SELECT application_state, status FROM job_applications WHERE id = ?`, [jobId],
    );
    if (!res.length || !res[0].values.length) return false;
    const [state, status] = res[0].values[0] as [string, string];
    return (TERMINAL_STATES as readonly string[]).includes(state) ||
      ['applied', 'questionnaire_done', 'interview'].includes(status);
  }

  getStats(): Record<string, number> {
    const res = this.db.exec(
      `SELECT status, COUNT(*) FROM job_applications GROUP BY status`,
    );
    if (!res.length) return {};
    return Object.fromEntries(res[0].values.map(r => [r[0] as string, r[1] as number]));
  }

  getStateStats(): Record<string, number> {
    const res = this.db.exec(
      `SELECT COALESCE(application_state, status), COUNT(*) FROM job_applications GROUP BY application_state`,
    );
    if (!res.length) return {};
    return Object.fromEntries(res[0].values.map(r => [r[0] as string, r[1] as number]));
  }

  listByStatus(status: ApplicationStatus, limit = 50): Record<string, unknown>[] {
    const res = this.db.exec(
      `SELECT * FROM job_applications WHERE status = ? ORDER BY updated_at DESC LIMIT ?`,
      [status, limit],
    );
    if (!res.length) return [];
    const cols = res[0].columns;
    return res[0].values.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
  }

  close(): void { this.save(); this.db.close(); }
}
