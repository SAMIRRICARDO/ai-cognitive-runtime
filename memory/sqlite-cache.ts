import { existsSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DB_DIR = resolve(ROOT, "memory", "cache");
const DB_PATH = resolve(DB_DIR, "ialeads-runtime.sqlite");

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

function nowIso() {
  return new Date().toISOString();
}

export function normalizeKey(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hashKey(value: string) {
  return createHash("sha256").update(normalizeKey(value)).digest("hex");
}

function json(value: JsonValue | undefined) {
  return JSON.stringify(value ?? {});
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class IALeadsCache {
  private db: DatabaseSync;

  constructor(path = DB_PATH) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.initialize();
  }

  private initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_hash TEXT NOT NULL UNIQUE,
        company TEXT NOT NULL,
        website TEXT,
        segment TEXT,
        status TEXT NOT NULL DEFAULT 'processed',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_hash TEXT NOT NULL UNIQUE,
        company_hash TEXT NOT NULL,
        company TEXT NOT NULL,
        contact_name TEXT,
        email TEXT,
        enrichment_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'enriched',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS outbound_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        email_hash TEXT NOT NULL,
        company_hash TEXT,
        company TEXT,
        campaign_id TEXT,
        email_type TEXT NOT NULL,
        sequence_number INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        sent_at TEXT NOT NULL,
        UNIQUE(email_hash, email_type, sequence_number)
      );

      CREATE TABLE IF NOT EXISTS prompts_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prompt_hash TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        prompt TEXT NOT NULL,
        response_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id TEXT NOT NULL UNIQUE,
        name TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runtime_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        source TEXT NOT NULL,
        event TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS companies_company_hash_idx ON companies(company_hash);
      CREATE INDEX IF NOT EXISTS leads_company_hash_idx ON leads(company_hash);
      CREATE INDEX IF NOT EXISTS leads_email_idx ON leads(email);
      CREATE INDEX IF NOT EXISTS outbound_email_hash_idx ON outbound_history(email_hash);
      CREATE INDEX IF NOT EXISTS runtime_logs_source_idx ON runtime_logs(source);
    `);
  }

  companyExists(company: string) {
    const row = this.db.prepare("SELECT id FROM companies WHERE company_hash = ?").get(hashKey(company));
    return Boolean(row);
  }

  clearAcquiredCompanies(): number {
    const result = this.db.prepare("DELETE FROM companies WHERE status = 'acquired'").run();
    return result.changes;
  }

  countAcquiredCompanies(): number {
    const row = this.db.prepare("SELECT COUNT(*) as n FROM companies WHERE status = 'acquired'").get() as { n: number };
    return row?.n ?? 0;
  }

  upsertCompany(input: {
    company: string;
    website?: string;
    segment?: string;
    status?: string;
    metadata?: Record<string, unknown>;
  }) {
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO companies (company_hash, company, website, segment, status, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(company_hash) DO UPDATE SET
        company = excluded.company,
        website = COALESCE(excluded.website, companies.website),
        segment = COALESCE(excluded.segment, companies.segment),
        status = excluded.status,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      hashKey(input.company),
      input.company,
      input.website ?? null,
      input.segment ?? null,
      input.status ?? "processed",
      json(input.metadata),
      timestamp,
      timestamp
    );
  }

  getLeadByCompany(company: string) {
    const row = this.db.prepare(`
      SELECT * FROM leads
      WHERE company_hash = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(hashKey(company)) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      ...row,
      enrichment: parseJson<Record<string, unknown>>(row.enrichment_json, {}),
    };
  }

  upsertLead(input: {
    company: string;
    contactName?: string;
    email?: string;
    enrichment?: Record<string, unknown>;
    status?: string;
  }) {
    const companyHash = hashKey(input.company);
    const leadHash = hashKey(`${input.company}:${input.email ?? input.contactName ?? "lead"}`);
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO leads (lead_hash, company_hash, company, contact_name, email, enrichment_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(lead_hash) DO UPDATE SET
        contact_name = COALESCE(excluded.contact_name, leads.contact_name),
        email = COALESCE(excluded.email, leads.email),
        enrichment_json = excluded.enrichment_json,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(
      leadHash,
      companyHash,
      input.company,
      input.contactName ?? null,
      input.email ?? null,
      json(input.enrichment),
      input.status ?? "enriched",
      timestamp,
      timestamp
    );
  }

  getPrompt(kind: string, prompt: string) {
    const row = this.db.prepare(`
      SELECT * FROM prompts_memory
      WHERE prompt_hash = ? AND kind = ?
      LIMIT 1
    `).get(hashKey(prompt), kind) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      ...row,
      response: parseJson<Record<string, unknown> | unknown[]>(row.response_json, {}),
      metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    };
  }

  savePrompt(input: {
    kind: string;
    prompt: string;
    response: JsonValue;
    metadata?: Record<string, unknown>;
  }) {
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO prompts_memory (prompt_hash, kind, prompt, response_json, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(prompt_hash) DO UPDATE SET
        response_json = excluded.response_json,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      hashKey(input.prompt),
      input.kind,
      input.prompt,
      json(input.response),
      json(input.metadata),
      timestamp,
      timestamp
    );
  }

  hasOutbound(input: { email: string; emailType?: string; sequenceNumber?: number }) {
    const row = this.db.prepare(`
      SELECT id, sent_at, status FROM outbound_history
      WHERE email_hash = ? AND email_type = ? AND sequence_number = ?
      LIMIT 1
    `).get(
      hashKey(input.email),
      input.emailType ?? "cold-outreach",
      input.sequenceNumber ?? 1
    ) as Record<string, unknown> | undefined;
    return row ?? null;
  }

  recordOutbound(input: {
    email: string;
    company?: string;
    campaignId?: string;
    emailType?: string;
    sequenceNumber?: number;
    status: string;
    metadata?: Record<string, unknown>;
    sentAt?: string;
  }) {
    this.db.prepare(`
      INSERT OR IGNORE INTO outbound_history
        (email, email_hash, company_hash, company, campaign_id, email_type, sequence_number, status, metadata_json, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.email,
      hashKey(input.email),
      input.company ? hashKey(input.company) : null,
      input.company ?? null,
      input.campaignId ?? null,
      input.emailType ?? "cold-outreach",
      input.sequenceNumber ?? 1,
      input.status,
      json(input.metadata),
      input.sentAt ?? nowIso()
    );
  }

  upsertCampaign(input: { campaignId: string; name?: string; metadata?: Record<string, unknown> }) {
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO campaigns (campaign_id, name, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(campaign_id) DO UPDATE SET
        name = COALESCE(excluded.name, campaigns.name),
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(input.campaignId, input.name ?? null, json(input.metadata), timestamp, timestamp);
  }

  log(source: string, event: string, metadata?: Record<string, unknown>) {
    this.db.prepare(`
      INSERT INTO runtime_logs (timestamp, source, event, metadata_json)
      VALUES (?, ?, ?, ?)
    `).run(nowIso(), source, event, json(metadata));
  }
}

let singleton: IALeadsCache | null = null;

export function getIALeadsCache() {
  if (!singleton) singleton = new IALeadsCache();
  return singleton;
}

export function sqliteCacheAvailable() {
  return existsSync(DB_PATH);
}
