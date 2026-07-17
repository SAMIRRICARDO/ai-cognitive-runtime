// packages/work/src/remote-dev/db/schema.ts
// Remote Dev Agent — SQLite schema (extends existing work.db)

export const RDA_SCHEMA = `
-- ── Devices ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rda_devices (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  platform      TEXT NOT NULL DEFAULT 'unknown',
  node_version  TEXT,
  hostname      TEXT,
  status        TEXT NOT NULL DEFAULT 'offline',
  last_seen_at  TEXT,
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  token_hash    TEXT NOT NULL,
  workspace_json TEXT
);

-- ── Executors ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rda_executors (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  available   INTEGER NOT NULL DEFAULT 0,
  version     TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Jobs ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rda_jobs (
  id             TEXT PRIMARY KEY,
  device_id      TEXT NOT NULL REFERENCES rda_devices(id),
  executor_id    TEXT NOT NULL,
  project_path   TEXT NOT NULL,
  mode           TEXT NOT NULL DEFAULT 'code',
  prompt         TEXT NOT NULL,
  permissions    TEXT NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'queued',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  started_at     TEXT,
  completed_at   TEXT,
  error_msg      TEXT
);

-- ── Job Events ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rda_job_events (
  id         TEXT PRIMARY KEY,
  job_id     TEXT NOT NULL REFERENCES rda_jobs(id),
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Metrics ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rda_metrics (
  id           TEXT PRIMARY KEY,
  job_id       TEXT NOT NULL REFERENCES rda_jobs(id),
  cpu_pct      REAL DEFAULT 0,
  ram_mb       REAL DEFAULT 0,
  tokens_used  INTEGER DEFAULT 0,
  files_changed INTEGER DEFAULT 0,
  tests_run    INTEGER DEFAULT 0,
  tests_passed INTEGER DEFAULT 0,
  commits      INTEGER DEFAULT 0,
  duration_ms  INTEGER DEFAULT 0,
  sampled_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Sessions (auth) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rda_sessions (
  id          TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL REFERENCES rda_devices(id),
  token_hash  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0
);

-- ── Audit Log ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rda_audit (
  id         TEXT PRIMARY KEY,
  device_id  TEXT,
  job_id     TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rda_jobs_device    ON rda_jobs(device_id);
CREATE INDEX IF NOT EXISTS idx_rda_jobs_status    ON rda_jobs(status);
CREATE INDEX IF NOT EXISTS idx_rda_events_job     ON rda_job_events(job_id);
CREATE INDEX IF NOT EXISTS idx_rda_metrics_job    ON rda_metrics(job_id);
CREATE INDEX IF NOT EXISTS idx_rda_sessions_dev   ON rda_sessions(device_id);
`;

export const SEED_EXECUTORS = `
INSERT OR IGNORE INTO rda_executors (id, name, description, available) VALUES
  ('claude-code', 'Claude Code',   'Anthropic Claude Code CLI — agentic coding', 1),
  ('codex',       'OpenAI Codex',  'OpenAI Codex CLI',                           0),
  ('gemini',      'Gemini CLI',    'Google Gemini CLI',                           0),
  ('cursor',      'Cursor Agent',  'Cursor AI Agent',                             0),
  ('aider',       'Aider',         'Aider — AI pair programming in terminal',     0),
  ('windsurf',    'Windsurf',      'Codeium Windsurf Agent',                      0);
`;
