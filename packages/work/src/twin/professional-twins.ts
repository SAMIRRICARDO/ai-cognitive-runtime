// packages/work/src/twin/professional-twins.ts
// ProfessionalTwinsStore — manages multiple specialized candidate profiles

import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import fs from 'fs';
import path from 'path';
import type { ProfessionalTwin, TwinId } from '../types/hire-intelligence.js';

const DB_DIR  = path.resolve(process.cwd(), '.vraxia-work');
const DB_PATH = path.join(DB_DIR, 'work.db');

// ── Default Twin definitions ──────────────────────────────────────────────────

const DEFAULT_TWINS: ProfessionalTwin[] = [
  {
    id: 'twin_ai_engineer',
    label: 'Senior AI/LLM Engineer',
    headline: 'Senior AI Engineer · LLM Systems · Multi-Agent Architectures · 15 years',
    about: `AI Systems Engineer with 15 years of experience, specialized in LLM-based systems
since 2022. Built production multi-agent runtimes using Anthropic Claude, OpenAI GPT, and
custom RAG pipelines. Designed and deployed VRAXIA OS — a cognitive runtime handling
multi-agent orchestration, semantic memory (pgvector), and token cost optimization.
Deep expertise in TypeScript/Node.js + Python for AI infrastructure.`,
    primaryStack: ['TypeScript', 'Python', 'Anthropic SDK', 'LangChain', 'pgvector'],
    skills: [
      'TypeScript', 'Node.js', 'Python', 'Anthropic SDK', 'OpenAI API',
      'LangChain', 'pgvector', 'Redis', 'PostgreSQL', 'Docker',
      'RAG pipelines', 'multi-agent orchestration', 'prompt engineering',
      'vector embeddings', 'semantic search', 'token optimization',
      'PyTorch', 'TensorFlow', 'scikit-learn', 'Hugging Face', 'MLOps',
      'machine learning', 'deep learning', 'model deployment', 'MLflow',
      'data science', 'LLM fine-tuning', 'inference optimization',
    ],
    atsKeywords: [
      // LLM / GenAI
      'LLM', 'RAG', 'multi-agent', 'Claude', 'OpenAI', 'GPT', 'embeddings',
      'vector database', 'pgvector', 'generative AI', 'NLP', 'transformer',
      'AI Engineer', 'LLM Engineer', 'AI infrastructure', 'Anthropic',
      'prompt engineering', 'AI systems', 'agent', 'agentic', 'fine-tuning',
      'GenAI', 'AI developer', 'AI lead', 'applied AI', 'AI product',
      // ML tradicional
      'machine learning', 'deep learning', 'neural network', 'PyTorch', 'TensorFlow',
      'scikit-learn', 'MLOps', 'Databricks', 'Hugging Face', 'Keras', 'MLflow',
      'Vertex AI', 'SageMaker', 'feature engineering', 'model training',
      'model inference', 'model deployment', 'computer vision', 'data science',
      'ML Engineer', 'AI researcher', 'inteligência artificial',
      'artificial intelligence', 'AI', 'IA',
    ],
    targetRoles: [
      'AI Engineer', 'LLM Engineer', 'GenAI Engineer', 'ML Engineer',
      'AI Developer', 'AI Infrastructure Engineer', 'Applied AI Engineer',
      'Machine Learning Engineer', 'AI Researcher', 'AI Lead',
      'AI Architect', 'Data Scientist', 'MLOps Engineer',
    ],
    targetSeniority: 'senior',
    targetSalary: 14000,
    currency: 'BRL',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'twin_backend',
    label: 'Senior Backend Engineer',
    headline: 'Senior Backend Engineer · TypeScript · Node.js · REST APIs · 15 years',
    about: `Senior Backend Engineer with 15 years of experience building scalable APIs and
distributed systems. Expert in TypeScript/Node.js with deep knowledge of PostgreSQL, Redis,
and Docker-based deployments. Built multiple production SaaS platforms from scratch including
multi-tenant architectures and high-throughput API gateways. Strong focus on code quality,
observability, and cost-efficient infrastructure.`,
    primaryStack: ['TypeScript', 'Node.js', 'PostgreSQL', 'Redis', 'Docker'],
    skills: [
      'TypeScript', 'Node.js', 'Express', 'Fastify', 'PostgreSQL',
      'Redis', 'Docker', 'REST API', 'GraphQL', 'AWS',
      'microservices', 'CI/CD', 'testing', 'observability', 'WebSockets',
    ],
    atsKeywords: [
      'Node.js', 'TypeScript', 'REST API', 'microservices', 'PostgreSQL',
      'Redis', 'Docker', 'AWS', 'Fastify', 'Express', 'GraphQL',
      'backend', 'API development', 'database', 'scalability',
      'software engineer', 'senior engineer', 'backend developer',
    ],
    targetRoles: [
      'Backend Engineer', 'Software Engineer', 'Node.js Developer',
      'TypeScript Developer', 'Backend Developer', 'API Engineer',
    ],
    targetSeniority: 'senior',
    targetSalary: 12000,
    currency: 'BRL',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'twin_architect',
    label: 'AI Solutions Architect',
    headline: 'AI Solutions Architect · Enterprise Systems · Multi-Tenant SaaS · 15 years',
    about: `AI Solutions Architect with 15 years designing and building enterprise-grade systems.
Specialized in AI-native architectures: multi-tenant SaaS platforms, RAG/semantic search
infrastructure, and LLM integration at scale. Led architecture for VRAXIA OS — cognitive
runtime supporting multi-agent orchestration, BYOK multi-tenancy, and departmental AI modules
with 1,100+ indexed skills. Brings both deep technical depth and strategic system design.`,
    primaryStack: ['TypeScript', 'Python', 'Azure', 'Docker', 'pgvector'],
    skills: [
      'TypeScript', 'Python', 'Azure', 'AWS', 'GCP',
      'Docker', 'Kubernetes', 'PostgreSQL', 'Redis', 'pgvector',
      'system design', 'enterprise architecture', 'multi-tenant SaaS',
      'LLM integration', 'API design', 'technical leadership',
    ],
    atsKeywords: [
      'solution architecture', 'enterprise', 'multi-tenant', 'SaaS',
      'scalability', 'systems design', 'technical leadership',
      'cloud architecture', 'AWS', 'Azure', 'microservices architecture',
      'AI architect', 'solutions architect', 'principal engineer',
      'staff engineer', 'system design', 'distributed systems',
    ],
    targetRoles: [
      'Solutions Architect', 'AI Architect', 'Principal Engineer',
      'Staff Engineer', 'Head of Engineering', 'Principal AI Engineer',
    ],
    targetSeniority: 'architect',
    targetSalary: 16000,
    currency: 'BRL',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'twin_techlead',
    label: 'Tech Lead / Engineering Lead',
    headline: 'Tech Lead · AI Systems · Full Stack · Team Leadership · 15 years',
    about: `Tech Lead with 15 years of engineering experience, combining strong technical depth
with team leadership. Built and led the full engineering effort at VRAXIA/VRASHOWS as
founder — from architecture decisions to hands-on implementation. Expert in TypeScript
full-stack development with AI integration. Experienced in code review, mentoring,
roadmap planning, and driving technical decisions that scale.`,
    primaryStack: ['TypeScript', 'Node.js', 'React', 'Python', 'PostgreSQL'],
    skills: [
      'TypeScript', 'Node.js', 'React', 'Python', 'PostgreSQL',
      'technical leadership', 'code review', 'mentoring', 'roadmap',
      'agile', 'scrum', 'system design', 'Docker', 'CI/CD',
    ],
    atsKeywords: [
      'tech lead', 'technical leadership', 'mentoring', 'code review',
      'roadmap', 'agile', 'scrum', 'team management', 'TypeScript',
      'Node.js', 'React', 'full stack', 'engineering lead', 'team lead',
      'principal software engineer', 'architecture decisions',
    ],
    targetRoles: [
      'Tech Lead', 'Engineering Lead', 'Technology Lead',
      'Principal Software Engineer', 'Lead Software Engineer', 'Technical Lead',
    ],
    targetSeniority: 'lead',
    targetSalary: 14000,
    currency: 'BRL',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// ── Store ─────────────────────────────────────────────────────────────────────

export class ProfessionalTwinsStore {
  private db!: Database;
  private SQL!: SqlJsStatic;
  private initialized = false;

  static async create(): Promise<ProfessionalTwinsStore> {
    const store = new ProfessionalTwinsStore();
    await store.init();
    return store;
  }

  private async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(DB_DIR, { recursive: true });
    this.SQL = await initSqlJs();
    this.db = fs.existsSync(DB_PATH)
      ? new this.SQL.Database(fs.readFileSync(DB_PATH))
      : new this.SQL.Database();
    this.migrate();
    this.seedDefaults();
    this.initialized = true;
  }

  private persist(): void {
    fs.writeFileSync(DB_PATH, Buffer.from(this.db.export()));
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS professional_twins (
        id               TEXT PRIMARY KEY,
        label            TEXT NOT NULL,
        headline         TEXT NOT NULL,
        about            TEXT NOT NULL,
        primary_stack    TEXT NOT NULL,
        skills           TEXT NOT NULL,
        ats_keywords     TEXT NOT NULL,
        target_roles     TEXT NOT NULL,
        target_seniority TEXT NOT NULL,
        target_salary    INTEGER NOT NULL,
        currency         TEXT NOT NULL DEFAULT 'BRL',
        resume_path      TEXT,
        resume_md        TEXT,
        is_active        INTEGER NOT NULL DEFAULT 1,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS hire_scores (
        job_id                TEXT PRIMARY KEY,
        twin_id               TEXT NOT NULL,
        technical_fit         REAL,
        salary_fit            REAL,
        seniority_fit         REAL,
        location_fit          REAL,
        ats_probability       REAL,
        historical_score      REAL,
        competition_level     TEXT,
        publication_age_days  INTEGER,
        applicant_count       INTEGER,
        interview_probability REAL NOT NULL,
        hire_score            REAL NOT NULL,
        action                TEXT NOT NULL,
        reasoning             TEXT,
        key_strengths         TEXT,
        key_weaknesses        TEXT,
        ats_keywords_found    TEXT,
        ats_keywords_missing  TEXT,
        scored_at             TEXT NOT NULL,
        expires_at            TEXT NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS interview_outcomes (
        id                           TEXT PRIMARY KEY,
        job_id                       TEXT NOT NULL,
        twin_id                      TEXT NOT NULL,
        cv_version                   TEXT,
        hire_score_at_apply          REAL,
        interview_probability_at_apply REAL,
        technical_fit_at_apply       REAL,
        ats_probability_at_apply     REAL,
        outcome                      TEXT,
        outcome_recorded_at          TEXT,
        response_time_days           INTEGER,
        company                      TEXT NOT NULL,
        job_title                    TEXT NOT NULL,
        platform                     TEXT NOT NULL,
        stack_tags                   TEXT,
        created_at                   TEXT NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS learning_patterns (
        id                  TEXT PRIMARY KEY,
        pattern_type        TEXT NOT NULL,
        pattern_key         TEXT NOT NULL,
        total_applications  INTEGER NOT NULL DEFAULT 0,
        interviews          INTEGER NOT NULL DEFAULT 0,
        rejections          INTEGER NOT NULL DEFAULT 0,
        no_response         INTEGER NOT NULL DEFAULT 0,
        offers              INTEGER NOT NULL DEFAULT 0,
        interview_rate      REAL NOT NULL DEFAULT 0,
        avg_hire_score      REAL,
        avg_response_days   REAL,
        last_updated        TEXT NOT NULL,
        UNIQUE(pattern_type, pattern_key)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS cv_versions (
        id              TEXT PRIMARY KEY,
        twin_id         TEXT NOT NULL,
        version_label   TEXT NOT NULL,
        content_md      TEXT NOT NULL,
        pdf_path        TEXT,
        applications    INTEGER NOT NULL DEFAULT 0,
        interviews      INTEGER NOT NULL DEFAULT 0,
        interview_rate  REAL NOT NULL DEFAULT 0,
        is_base         INTEGER NOT NULL DEFAULT 0,
        parent_version_id TEXT,
        created_at      TEXT NOT NULL
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_hire_scores_twin  ON hire_scores(twin_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_outcomes_twin     ON interview_outcomes(twin_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_outcomes_job      ON interview_outcomes(job_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_patterns_type_key ON learning_patterns(pattern_type, pattern_key)`);

    // ── D.I.A. — Outcome Timeline (additive, never break existing rows) ────────
    this.db.run(`
      CREATE TABLE IF NOT EXISTS outcome_timeline (
        id              TEXT PRIMARY KEY,
        job_id          TEXT NOT NULL,
        twin_id         TEXT NOT NULL,
        outcome_state   TEXT NOT NULL,
        notes           TEXT,
        days_since_apply INTEGER,
        created_at      TEXT NOT NULL
      )
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_otl_job ON outcome_timeline(job_id)`);

    // ── New columns on hire_scores (idempotent) ────────────────────────────────
    const addHSCol = (col: string, def: string) => {
      try { this.db.run(`ALTER TABLE hire_scores ADD COLUMN ${col} ${def}`); } catch { /* já existe */ }
    };
    addHSCol('decision_score   REAL',   'DEFAULT NULL');
    addHSCol('priority         TEXT',   'DEFAULT NULL');
    addHSCol('priority_actions TEXT',   'DEFAULT NULL');
    addHSCol('company_tier     TEXT',   'DEFAULT NULL');
    addHSCol('company_score    REAL',   'DEFAULT NULL');
    addHSCol('timing_score     REAL',   'DEFAULT NULL');

    // ── New columns on interview_outcomes ──────────────────────────────────────
    const addIOCol = (col: string, def: string) => {
      try { this.db.run(`ALTER TABLE interview_outcomes ADD COLUMN ${col} ${def}`); } catch { /* já existe */ }
    };
    addIOCol('outcome_state    TEXT',   'DEFAULT NULL');
    addIOCol('current_state    TEXT',   'DEFAULT NULL');

    // ── 2026-07: Expand twin_ai_engineer to cover ML/traditional AI ecosystem ──
    // Only runs when PyTorch is not yet in ats_keywords (idempotent)
    try {
      const expandedKeywords = JSON.stringify([
        'LLM', 'RAG', 'multi-agent', 'Claude', 'OpenAI', 'GPT', 'embeddings',
        'vector database', 'pgvector', 'generative AI', 'NLP', 'transformer',
        'AI Engineer', 'LLM Engineer', 'AI infrastructure', 'Anthropic',
        'prompt engineering', 'AI systems', 'agent', 'agentic', 'fine-tuning',
        'GenAI', 'AI developer', 'AI lead', 'applied AI', 'AI product',
        'machine learning', 'deep learning', 'neural network', 'PyTorch', 'TensorFlow',
        'scikit-learn', 'MLOps', 'Databricks', 'Hugging Face', 'Keras', 'MLflow',
        'Vertex AI', 'SageMaker', 'feature engineering', 'model training',
        'model inference', 'model deployment', 'computer vision', 'data science',
        'ML Engineer', 'AI researcher', 'inteligência artificial',
        'artificial intelligence', 'AI', 'IA',
      ]);
      const expandedSkills = JSON.stringify([
        'TypeScript', 'Node.js', 'Python', 'Anthropic SDK', 'OpenAI API',
        'LangChain', 'pgvector', 'Redis', 'PostgreSQL', 'Docker',
        'RAG pipelines', 'multi-agent orchestration', 'prompt engineering',
        'vector embeddings', 'semantic search', 'token optimization',
        'PyTorch', 'TensorFlow', 'scikit-learn', 'Hugging Face', 'MLOps',
        'machine learning', 'deep learning', 'model deployment', 'MLflow',
        'data science', 'LLM fine-tuning', 'inference optimization',
      ]);
      this.db.run(
        `UPDATE professional_twins SET ats_keywords = ?, skills = ?, updated_at = ?
         WHERE id = 'twin_ai_engineer' AND ats_keywords NOT LIKE '%PyTorch%'`,
        [expandedKeywords, expandedSkills, new Date().toISOString()],
      );
    } catch { /* silently skip if table not created yet */ }

    this.persist();
  }

  private seedDefaults(): void {
    for (const twin of DEFAULT_TWINS) {
      const exists = this.db.exec(`SELECT id FROM professional_twins WHERE id = ?`, [twin.id]);
      if (exists.length && exists[0].values.length) continue;

      this.db.run(`
        INSERT INTO professional_twins (
          id, label, headline, about,
          primary_stack, skills, ats_keywords, target_roles,
          target_seniority, target_salary, currency,
          resume_path, resume_md, is_active, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        twin.id, twin.label, twin.headline, twin.about,
        JSON.stringify(twin.primaryStack),
        JSON.stringify(twin.skills),
        JSON.stringify(twin.atsKeywords),
        JSON.stringify(twin.targetRoles),
        twin.targetSeniority, twin.targetSalary, twin.currency,
        twin.resumePath ?? null,
        twin.resumeMd ?? null,
        twin.isActive ? 1 : 0,
        twin.createdAt, twin.updatedAt,
      ]);
    }
    this.persist();
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  getAll(activeOnly = true): ProfessionalTwin[] {
    const sql = activeOnly
      ? `SELECT * FROM professional_twins WHERE is_active = 1`
      : `SELECT * FROM professional_twins`;
    const res = this.db.exec(sql);
    if (!res.length) return [];
    return res[0].values.map(row => this.rowToTwin(res[0].columns, row));
  }

  getById(id: TwinId): ProfessionalTwin | null {
    const res = this.db.exec(`SELECT * FROM professional_twins WHERE id = ?`, [id]);
    if (!res.length || !res[0].values.length) return null;
    return this.rowToTwin(res[0].columns, res[0].values[0]);
  }

  private rowToTwin(columns: string[], row: unknown[]): ProfessionalTwin {
    const obj: Record<string, unknown> = {};
    columns.forEach((c, i) => obj[c] = row[i]);
    return {
      id:               obj['id'] as TwinId,
      label:            obj['label'] as string,
      headline:         obj['headline'] as string,
      about:            obj['about'] as string,
      primaryStack:     JSON.parse(obj['primary_stack'] as string),
      skills:           JSON.parse(obj['skills'] as string),
      atsKeywords:      JSON.parse(obj['ats_keywords'] as string),
      targetRoles:      JSON.parse(obj['target_roles'] as string),
      targetSeniority:  obj['target_seniority'] as ProfessionalTwin['targetSeniority'],
      targetSalary:     obj['target_salary'] as number,
      currency:         (obj['currency'] as 'BRL' | 'USD') ?? 'BRL',
      resumePath:       obj['resume_path'] as string | undefined,
      resumeMd:         obj['resume_md'] as string | undefined,
      isActive:         Boolean(obj['is_active']),
      createdAt:        obj['created_at'] as string,
      updatedAt:        obj['updated_at'] as string,
    };
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  upsert(twin: ProfessionalTwin): void {
    const now = new Date().toISOString();
    this.db.run(`
      INSERT INTO professional_twins (
        id, label, headline, about,
        primary_stack, skills, ats_keywords, target_roles,
        target_seniority, target_salary, currency,
        resume_path, resume_md, is_active, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        headline = excluded.headline,
        about = excluded.about,
        primary_stack = excluded.primary_stack,
        skills = excluded.skills,
        ats_keywords = excluded.ats_keywords,
        target_roles = excluded.target_roles,
        target_seniority = excluded.target_seniority,
        target_salary = excluded.target_salary,
        currency = excluded.currency,
        resume_path = COALESCE(excluded.resume_path, resume_path),
        resume_md = COALESCE(excluded.resume_md, resume_md),
        is_active = excluded.is_active,
        updated_at = excluded.updated_at
    `, [
      twin.id, twin.label, twin.headline, twin.about,
      JSON.stringify(twin.primaryStack),
      JSON.stringify(twin.skills),
      JSON.stringify(twin.atsKeywords),
      JSON.stringify(twin.targetRoles),
      twin.targetSeniority, twin.targetSalary, twin.currency,
      twin.resumePath ?? null,
      twin.resumeMd ?? null,
      twin.isActive ? 1 : 0,
      twin.createdAt, now,
    ]);
    this.persist();
  }

  setResume(id: TwinId, resumeMd: string, resumePath?: string): void {
    this.db.run(`
      UPDATE professional_twins SET resume_md = ?, resume_path = COALESCE(?, resume_path), updated_at = ?
      WHERE id = ?
    `, [resumeMd, resumePath ?? null, new Date().toISOString(), id]);
    this.persist();
  }

  // ── Hire Score cache ──────────────────────────────────────────────────────

  getCachedHireScore(jobId: string, maxAgeDays = 3): import('../types/hire-intelligence.js').HireScore | null {
    const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
    const res = this.db.exec(
      `SELECT * FROM hire_scores WHERE job_id = ? AND expires_at >= ?`,
      [jobId, new Date().toISOString()],
    );
    if (!res.length || !res[0].values.length) return null;
    try {
      const cols = res[0].columns;
      const row  = res[0].values[0];
      const obj: Record<string, unknown> = {};
      cols.forEach((c, i) => obj[c] = row[i]);
      return {
        jobId: obj['job_id'] as string,
        twinId: obj['twin_id'] as import('../types/hire-intelligence.js').TwinId,
        dimensions: {
          technicalFit:    obj['technical_fit'] as number,
          salaryFit:       obj['salary_fit'] as number,
          seniorityFit:    obj['seniority_fit'] as number,
          locationFit:     obj['location_fit'] as number,
          atsProbability:  obj['ats_probability'] as number,
          historicalScore: obj['historical_score'] as number,
        },
        marketContext: {
          competitionLevel: obj['competition_level'] as import('../types/hire-intelligence.js').CompetitionLevel,
          publicationAgeDays: obj['publication_age_days'] as number,
          applicantCount: obj['applicant_count'] as number | undefined,
          platformEaseScore: 70,
        },
        interviewProbability: obj['interview_probability'] as number,
        hireScore:            obj['hire_score'] as number,
        action:               obj['action'] as import('../types/index.js').ApplyAction,
        reasoning:            obj['reasoning'] as string,
        keyStrengths:         JSON.parse((obj['key_strengths'] as string) ?? '[]'),
        keyWeaknesses:        JSON.parse((obj['key_weaknesses'] as string) ?? '[]'),
        atsKeywordsFound:     JSON.parse((obj['ats_keywords_found'] as string) ?? '[]'),
        atsKeywordsMissing:   JSON.parse((obj['ats_keywords_missing'] as string) ?? '[]'),
        scoredAt:             obj['scored_at'] as string,
        expiresAt:            obj['expires_at'] as string,
      };
    } catch { return null; }
    void cutoff; // TTL checked via expires_at column
  }

  saveHireScore(score: import('../types/hire-intelligence.js').HireScore): void {
    this.db.run(`
      INSERT INTO hire_scores (
        job_id, twin_id,
        technical_fit, salary_fit, seniority_fit, location_fit, ats_probability, historical_score,
        competition_level, publication_age_days, applicant_count,
        interview_probability, hire_score, action, reasoning,
        key_strengths, key_weaknesses, ats_keywords_found, ats_keywords_missing,
        scored_at, expires_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(job_id) DO UPDATE SET
        twin_id = excluded.twin_id,
        technical_fit = excluded.technical_fit,
        salary_fit = excluded.salary_fit,
        seniority_fit = excluded.seniority_fit,
        location_fit = excluded.location_fit,
        ats_probability = excluded.ats_probability,
        historical_score = excluded.historical_score,
        competition_level = excluded.competition_level,
        publication_age_days = excluded.publication_age_days,
        applicant_count = excluded.applicant_count,
        interview_probability = excluded.interview_probability,
        hire_score = excluded.hire_score,
        action = excluded.action,
        reasoning = excluded.reasoning,
        key_strengths = excluded.key_strengths,
        key_weaknesses = excluded.key_weaknesses,
        ats_keywords_found = excluded.ats_keywords_found,
        ats_keywords_missing = excluded.ats_keywords_missing,
        scored_at = excluded.scored_at,
        expires_at = excluded.expires_at
    `, [
      score.jobId, score.twinId,
      score.dimensions.technicalFit,
      score.dimensions.salaryFit,
      score.dimensions.seniorityFit,
      score.dimensions.locationFit,
      score.dimensions.atsProbability,
      score.dimensions.historicalScore,
      score.marketContext.competitionLevel,
      score.marketContext.publicationAgeDays,
      score.marketContext.applicantCount ?? null,
      score.interviewProbability,
      score.hireScore,
      score.action,
      score.reasoning,
      JSON.stringify(score.keyStrengths),
      JSON.stringify(score.keyWeaknesses),
      JSON.stringify(score.atsKeywordsFound),
      JSON.stringify(score.atsKeywordsMissing),
      score.scoredAt,
      score.expiresAt,
    ]);
    this.persist();
  }

  // ── Interview Outcomes ────────────────────────────────────────────────────

  saveOutcome(outcome: import('../types/hire-intelligence.js').InterviewOutcome): void {
    this.db.run(`
      INSERT INTO interview_outcomes (
        id, job_id, twin_id, cv_version,
        hire_score_at_apply, interview_probability_at_apply,
        technical_fit_at_apply, ats_probability_at_apply,
        outcome, outcome_recorded_at, response_time_days,
        company, job_title, platform, stack_tags, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        outcome = excluded.outcome,
        outcome_recorded_at = excluded.outcome_recorded_at,
        response_time_days = excluded.response_time_days
    `, [
      outcome.id, outcome.jobId, outcome.twinId, outcome.cvVersion ?? null,
      outcome.hireScoreAtApply, outcome.interviewProbabilityAtApply,
      outcome.technicalFitAtApply, outcome.atsProbabilityAtApply,
      outcome.outcome ?? null, outcome.outcomeRecordedAt ?? null,
      outcome.responseTimeDays ?? null,
      outcome.company, outcome.jobTitle, outcome.platform,
      JSON.stringify(outcome.stackTags),
      outcome.createdAt,
    ]);
    this.persist();
  }

  // ── Learning Patterns ─────────────────────────────────────────────────────

  getLearningPattern(type: import('../types/hire-intelligence.js').PatternType, key: string): import('../types/hire-intelligence.js').LearningPattern | null {
    const res = this.db.exec(
      `SELECT * FROM learning_patterns WHERE pattern_type = ? AND pattern_key = ?`,
      [type, key],
    );
    if (!res.length || !res[0].values.length) return null;
    const cols = res[0].columns;
    const row  = res[0].values[0];
    const obj: Record<string, unknown> = {};
    cols.forEach((c, i) => obj[c] = row[i]);
    return {
      id:                obj['id'] as string,
      patternType:       obj['pattern_type'] as import('../types/hire-intelligence.js').PatternType,
      patternKey:        obj['pattern_key'] as string,
      totalApplications: obj['total_applications'] as number,
      interviews:        obj['interviews'] as number,
      rejections:        obj['rejections'] as number,
      noResponse:        obj['no_response'] as number,
      offers:            obj['offers'] as number,
      interviewRate:     obj['interview_rate'] as number,
      avgHireScore:      obj['avg_hire_score'] as number,
      avgResponseDays:   obj['avg_response_days'] as number | undefined,
      lastUpdated:       obj['last_updated'] as string,
    };
  }

  getTopPatterns(type: import('../types/hire-intelligence.js').PatternType, limit = 10): import('../types/hire-intelligence.js').LearningPattern[] {
    const res = this.db.exec(
      `SELECT * FROM learning_patterns WHERE pattern_type = ? AND total_applications >= 2
       ORDER BY interview_rate DESC LIMIT ?`,
      [type, limit],
    );
    if (!res.length) return [];
    return res[0].values.map(row => {
      const obj: Record<string, unknown> = {};
      res[0].columns.forEach((c, i) => obj[c] = row[i]);
      return {
        id: obj['id'] as string,
        patternType: obj['pattern_type'] as import('../types/hire-intelligence.js').PatternType,
        patternKey: obj['pattern_key'] as string,
        totalApplications: obj['total_applications'] as number,
        interviews: obj['interviews'] as number,
        rejections: obj['rejections'] as number,
        noResponse: obj['no_response'] as number,
        offers: obj['offers'] as number,
        interviewRate: obj['interview_rate'] as number,
        avgHireScore: obj['avg_hire_score'] as number,
        avgResponseDays: obj['avg_response_days'] as number | undefined,
        lastUpdated: obj['last_updated'] as string,
      };
    });
  }

  // ── D.I.A. Outcome Timeline ───────────────────────────────────────────────

  saveOutcomeTimeline(entry: {
    id: string;
    jobId: string;
    twinId: string;
    outcomeState: string;
    notes?: string;
    daysSinceApply?: number;
  }): void {
    this.db.run(`
      INSERT INTO outcome_timeline (id, job_id, twin_id, outcome_state, notes, days_since_apply, created_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO NOTHING
    `, [
      entry.id, entry.jobId, entry.twinId, entry.outcomeState,
      entry.notes ?? null, entry.daysSinceApply ?? null,
      new Date().toISOString(),
    ]);
    this.persist();
  }

  getOutcomeTimeline(jobId: string): Array<{
    id: string; jobId: string; twinId: string; outcomeState: string;
    notes: string | null; daysSinceApply: number | null; createdAt: string;
  }> {
    const res = this.db.exec(
      `SELECT id, job_id, twin_id, outcome_state, notes, days_since_apply, created_at
       FROM outcome_timeline WHERE job_id = ? ORDER BY created_at ASC`,
      [jobId],
    );
    if (!res.length) return [];
    const cols = res[0].columns;
    return res[0].values.map(row => {
      const obj: Record<string, unknown> = {};
      cols.forEach((c, i) => obj[c] = row[i]);
      return {
        id:             obj['id'] as string,
        jobId:          obj['job_id'] as string,
        twinId:         obj['twin_id'] as string,
        outcomeState:   obj['outcome_state'] as string,
        notes:          obj['notes'] as string | null,
        daysSinceApply: obj['days_since_apply'] as number | null,
        createdAt:      obj['created_at'] as string,
      };
    });
  }

  // ── Update decision_score in hire_scores ──────────────────────────────────

  saveDecisionScore(jobId: string, opts: {
    decisionScore: number;
    priority: string;
    priorityActions: string[];
    companyTier: string;
    companyScore: number;
    timingScore: number;
  }): void {
    this.db.run(`
      UPDATE hire_scores SET
        decision_score   = ?,
        priority         = ?,
        priority_actions = ?,
        company_tier     = ?,
        company_score    = ?,
        timing_score     = ?
      WHERE job_id = ?
    `, [
      opts.decisionScore, opts.priority, JSON.stringify(opts.priorityActions),
      opts.companyTier, opts.companyScore, opts.timingScore,
      jobId,
    ]);
    this.persist();
  }

  close(): void { this.persist(); this.db.close(); }
}
