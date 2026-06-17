import pg from "pg";
import OpenAI from "openai";
import crypto from "crypto";
import { env } from "../config/env.js";
import { RedisMemory } from "./short-term/redis.js";
import { logger } from "../config/logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MemoryType = "episodic" | "semantic" | "procedural";

export interface Memory {
  id?: string;
  type: MemoryType;
  content: string;
  context: string;
  agentName: string;
  importance: number;   // 0.0 – 1.0
  accessCount?: number;
  tags: string[];
  createdAt?: string;
  lastAccessedAt?: string;
}

export interface MemorySearchResult extends Memory {
  id: string;
  score: number;
  accessCount: number;
  createdAt: string;
  lastAccessedAt: string;
}

export interface ConsolidationResult {
  merged: number;
  kept: number;
  removed: number;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBED_CACHE_TTL = 86_400 * 3;   // 3 days for memory embeddings
const DUPLICATE_THRESHOLD = 0.92;
const PRUNE_MIN_IMPORTANCE = 0.2;
const PRUNE_MIN_ACCESS = 2;
const PRUNE_MAX_AGE_DAYS = 60;

// ─── MemoryManager ────────────────────────────────────────────────────────────

export class MemoryManager {
  private pool: pg.Pool | null = null;
  private openai: OpenAI | null = null;
  private redis: RedisMemory;
  private tenantId: string;

  constructor(tenantId = "default") {
    this.tenantId = tenantId;
    // Namespace Redis embedding cache per tenant to avoid cross-tenant cache collisions
    this.redis = new RedisMemory(`t:${tenantId}`);

    if (env.ENABLE_MEMORY !== "false") {
      if (!env.DATABASE_URL) throw new Error("DATABASE_URL required for MemoryManager");
      if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required for MemoryManager");
      this.pool = new pg.Pool({ connectionString: env.DATABASE_URL });
      this.openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    }
  }

  // ── Schema ───────────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    const pool = this.pool;
    if (!pool) return;

    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_memories (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id        TEXT NOT NULL DEFAULT 'default',
        type             TEXT NOT NULL CHECK (type IN ('episodic','semantic','procedural')),
        content          TEXT NOT NULL,
        context          TEXT NOT NULL DEFAULT '',
        agent_name       TEXT NOT NULL DEFAULT '',
        importance       FLOAT NOT NULL DEFAULT 0.5,
        access_count     INT NOT NULL DEFAULT 0,
        tags             TEXT[] DEFAULT '{}',
        embedding        vector(1536),
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        last_accessed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS agent_memories_embedding_idx
        ON agent_memories USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 50)
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS agent_memories_tenant_idx ON agent_memories (tenant_id)`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS agent_memories_agent_idx ON agent_memories (agent_name)`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS agent_memories_type_idx ON agent_memories (type)`
    );
    logger.info("[memory-manager] schema ready", { tenantId: this.tenantId });
  }

  // ── Embedding ─────────────────────────────────────────────────────────────────

  private async embed(text: string): Promise<number[]> {
    const openai = this.openai;
    if (!openai) return [];

    const key = "membed:" + crypto.createHash("sha256").update(text).digest("hex").slice(0, 24);
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) return JSON.parse(cached) as number[];

    const res = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000),
    });
    const embedding = res.data[0].embedding;
    await this.redis.set(key, JSON.stringify(embedding), EMBED_CACHE_TTL).catch(() => {});
    return embedding;
  }

  // ── Store ─────────────────────────────────────────────────────────────────────

  async store(memory: Memory): Promise<string> {
    const pool = this.pool;
    if (!pool) return "";

    const embedding = await this.embed(memory.content);

    const { rows } = await pool.query(
      `INSERT INTO agent_memories
         (tenant_id, type, content, context, agent_name, importance, tags, embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        this.tenantId,
        memory.type,
        memory.content,
        memory.context,
        memory.agentName,
        memory.importance,
        memory.tags,
        `[${embedding.join(",")}]`,
      ]
    );

    logger.debug("[memory-manager] stored", { id: rows[0].id, type: memory.type, agent: memory.agentName, tenantId: this.tenantId });
    return rows[0].id as string;
  }

  // ── Search ────────────────────────────────────────────────────────────────────

  async search(
    query: string,
    options: {
      agentName?: string;
      type?: MemoryType;
      limit?: number;
      minScore?: number;
      minImportance?: number;
    } = {}
  ): Promise<MemorySearchResult[]> {
    const pool = this.pool;
    if (!pool) return [];

    const { agentName, type, limit = 8, minScore = 0.35, minImportance = 0 } = options;
    const embedding = await this.embed(query);
    if (embedding.length === 0) return [];

    let sql = `
      SELECT id, type, content, context, agent_name, importance,
             access_count, tags, created_at, last_accessed_at,
             1 - (embedding <=> $1::vector) AS score
      FROM agent_memories
      WHERE tenant_id = $2
        AND 1 - (embedding <=> $1::vector) >= $3
        AND importance >= $4
    `;
    const params: unknown[] = [`[${embedding.join(",")}]`, this.tenantId, minScore, minImportance];

    if (agentName) { sql += ` AND agent_name = $${params.length + 1}`; params.push(agentName); }
    if (type)      { sql += ` AND type = $${params.length + 1}`;        params.push(type);      }

    sql += ` ORDER BY score DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const { rows } = await pool.query(sql, params);

    if (rows.length > 0) {
      const ids = rows.map((r: any) => r.id);
      pool.query(
        `UPDATE agent_memories
         SET access_count = access_count + 1, last_accessed_at = NOW()
         WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [this.tenantId, ids]
      ).catch(() => {});
    }

    return rows.map((r: any) => ({
      id: r.id,
      type: r.type as MemoryType,
      content: r.content,
      context: r.context,
      agentName: r.agent_name,
      importance: Number(r.importance),
      accessCount: Number(r.access_count),
      tags: r.tags,
      createdAt: r.created_at,
      lastAccessedAt: r.last_accessed_at,
      score: Number(r.score),
    }));
  }

  // ── Context injection ─────────────────────────────────────────────────────────

  async getContextFor(agentName: string, task: string, limit = 5): Promise<string> {
    if (!this.pool) return "";

    const memories = await this.search(task, { agentName, limit, minScore: 0.4 });
    if (memories.length === 0) return "";

    const lines = memories.map((m) => {
      const age = this.relativeAge(m.createdAt);
      return `- [${m.type}] ${m.content} (importance=${m.importance.toFixed(1)}, ${age})`;
    });

    return `\n## Relevant memories from past runs\n${lines.join("\n")}\n`;
  }

  // ── Update / Delete ───────────────────────────────────────────────────────────

  async update(id: string, patch: Partial<Pick<Memory, "content" | "importance" | "tags">>): Promise<void> {
    const pool = this.pool;
    if (!pool) return;

    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.content !== undefined) {
      const embedding = await this.embed(patch.content);
      sets.push(`content = $${params.length + 1}`, `embedding = $${params.length + 2}::vector`);
      params.push(patch.content, `[${embedding.join(",")}]`);
    }
    if (patch.importance !== undefined) {
      sets.push(`importance = $${params.length + 1}`);
      params.push(patch.importance);
    }
    if (patch.tags !== undefined) {
      sets.push(`tags = $${params.length + 1}`);
      params.push(patch.tags);
    }

    if (sets.length === 0) return;
    params.push(this.tenantId, id);
    await pool.query(
      `UPDATE agent_memories SET ${sets.join(", ")} WHERE tenant_id = $${params.length - 1} AND id = $${params.length}`,
      params
    );
  }

  async delete(id: string): Promise<void> {
    const pool = this.pool;
    if (!pool) return;

    await pool.query(`DELETE FROM agent_memories WHERE tenant_id = $1 AND id = $2`, [this.tenantId, id]);
    logger.debug("[memory-manager] deleted", { id });
  }

  // ── Consolidate ───────────────────────────────────────────────────────────────

  async consolidate(agentName?: string): Promise<ConsolidationResult> {
    const pool = this.pool;
    if (!pool) return { merged: 0, kept: 0, removed: 0 };

    let sql = `
      SELECT a.id AS id_a, b.id AS id_b,
             a.importance AS imp_a, b.importance AS imp_b,
             1 - (a.embedding <=> b.embedding) AS similarity
      FROM agent_memories a
      JOIN agent_memories b ON a.id < b.id
        AND a.tenant_id = b.tenant_id
        AND 1 - (a.embedding <=> b.embedding) > $1
      WHERE a.tenant_id = $2
    `;
    const params: unknown[] = [DUPLICATE_THRESHOLD, this.tenantId];

    if (agentName) {
      sql += ` AND a.agent_name = $3 AND b.agent_name = $3`;
      params.push(agentName);
    }

    const { rows } = await pool.query(sql, params);

    let merged = 0;
    const toDelete = new Set<string>();

    for (const row of rows) {
      if (toDelete.has(row.id_a) || toDelete.has(row.id_b)) continue;
      const deleteId = row.imp_a >= row.imp_b ? row.id_b : row.id_a;
      toDelete.add(deleteId);
      merged++;
    }

    for (const id of toDelete) {
      await this.delete(id);
    }

    const { rows: remaining } = await pool.query(
      agentName
        ? `SELECT COUNT(*) FROM agent_memories WHERE tenant_id = $1 AND agent_name = $2`
        : `SELECT COUNT(*) FROM agent_memories WHERE tenant_id = $1`,
      agentName ? [this.tenantId, agentName] : [this.tenantId]
    );

    logger.info("[memory-manager] consolidate done", { merged, kept: Number(remaining[0].count) });
    return { merged, kept: Number(remaining[0].count), removed: merged };
  }

  // ── Prune ─────────────────────────────────────────────────────────────────────

  async prune(agentName?: string): Promise<number> {
    const pool = this.pool;
    if (!pool) return 0;

    const cutoff = new Date(Date.now() - PRUNE_MAX_AGE_DAYS * 86_400_000).toISOString();
    let sql = `
      DELETE FROM agent_memories
      WHERE tenant_id = $1
        AND importance < $2
        AND access_count < $3
        AND created_at < $4
    `;
    const params: unknown[] = [this.tenantId, PRUNE_MIN_IMPORTANCE, PRUNE_MIN_ACCESS, cutoff];

    if (agentName) {
      sql += ` AND agent_name = $5`;
      params.push(agentName);
    }

    const { rowCount } = await pool.query(sql, params);
    logger.info("[memory-manager] pruned", { removed: rowCount, agentName, tenantId: this.tenantId });
    return rowCount ?? 0;
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  async stats(agentName?: string): Promise<Record<string, unknown>> {
    const pool = this.pool;
    if (!pool) return { byType: [] };

    const { rows } = await pool.query(
      agentName
        ? `SELECT type, COUNT(*) AS count, AVG(importance) AS avg_importance
           FROM agent_memories WHERE tenant_id = $1 AND agent_name = $2 GROUP BY type`
        : `SELECT agent_name, type, COUNT(*) AS count, AVG(importance) AS avg_importance
           FROM agent_memories WHERE tenant_id = $1 GROUP BY agent_name, type ORDER BY agent_name, type`,
      agentName ? [this.tenantId, agentName] : [this.tenantId]
    );
    return { byType: rows };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private relativeAge(iso: string): string {
    const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
    if (days < 1) return "today";
    if (days < 7) return `${Math.floor(days)}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }

  async close(): Promise<void> {
    if (this.pool) await this.pool.end();
  }
}

// Default singleton for single-tenant / legacy scripts
export const memoryManager = new MemoryManager("default");
