-- Migration 001: Multi-tenant support
-- Run once against the existing database. Safe to re-run (IF NOT EXISTS / IF NOT EXISTS checks).

-- 1. Extend agent_memories with tenant isolation
ALTER TABLE agent_memories
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS agent_memories_tenant_idx
  ON agent_memories (tenant_id);

-- 2. Tenants registry — stores VRAXIA clients
CREATE TABLE IF NOT EXISTS tenants (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  api_key            TEXT UNIQUE NOT NULL,
  plan               TEXT NOT NULL DEFAULT 'starter'
                       CHECK (plan IN ('starter','professional','business','enterprise')),
  modules            TEXT[] NOT NULL DEFAULT '{}',
  active             BOOLEAN NOT NULL DEFAULT true,

  -- Encrypted client API keys (AES-256-GCM, server-side master key)
  anthropic_key_enc  TEXT,
  openai_key_enc     TEXT,
  tavily_key_enc     TEXT,
  resend_key_enc     TEXT,

  -- Plaintext config (non-secret)
  resend_from_email  TEXT,
  resend_from_name   TEXT,
  outbound_bcc_email TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenants_api_key_idx ON tenants (api_key);
CREATE INDEX IF NOT EXISTS tenants_active_idx  ON tenants (active);
