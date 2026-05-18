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
const DUPLICATE_THRESHOLD = 0.92;      // cosine score above which memories are considered duplicates
const PRUNE_MIN_IMPORTANCE = 0.2;
const PRUNE_MIN_ACCESS = 2;
const PRUNE_MAX_AGE_DAYS = 60;

// ─── MemoryManager ────────────────────────────────────────────────────────────

export class MemoryManager {
  private pool: pg.Pool;
  private openai: OpenAI;
  private redis = new RedisMemory();

  constructor() {
    if (!env.DATABASE_URL) throw new Error("DATABASE_URL required for MemoryManager");
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required for MemoryManager");
    this.pool = new pg.Pool({ connectionString: env.DATABASE_URL });
    this.openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  // ── Schema ───────────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    await this.pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS agent_memories (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS agent_memories_embedding_idx
        ON agent_memories USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 50)
    `);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS agent_memories_agent_idx ON agent_memories (agent_name)`
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS agent_memories_type_idx ON agent_memories (type)`
    );
    logger.info("[memory-manager] schema ready");
  }

  // ── Embedding ─────────────────────────────────────────────────────────────────

  private async embed(text: string): Promise<number[]> {
    const key = "membed:" + crypto.createHash("sha256").update(text).digest("hex").slice(0, 24);
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) return JSON.parse(cached) as number[];

    const res = await this.openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000),
    });
    const embedding = res.data[0].embedding;
    await this.redis.set(key, JSON.stringify(embedding), EMBED_CACHE_TTL).catch(() => {});
    return embedding;
  }

  // ── Store ─────────────────────────────────────────────────────────────────────

  async store(memory: Memory): Promise<string> {
    const embedding = await this.embed(memory.content);

    const { rows } = await this.pool.query(
      `INSERT INTO agent_memories
         (type, content, context, agent_name, importance, tags, embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [
        memory.type,
        memory.content,
        memory.context,
        memory.agentName,
        memory.importance,
        memory.tags,
        `[${embedding.join(",")}]`,
      ]
    );

    logger.debug("[memory-manager] stored", { id: rows[0].id, type: memory.type, agent: memory.agentName });
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
    const { agentName, type, limit = 8, minScore = 0.35, minImportance = 0 } = options;
    const embedding = await this.embed(query);

    let sql = `
      SELECT id, type, content, context, agent_name, importance,
             access_count, tags, created_at, last_accessed_at,
             1 - (embedding <=> $1::vector) AS score
      FROM agent_memories
      WHERE 1 - (embedding <=> $1::vector) >= $2
        AND importance >= $3
    `;
    const params: unknown[] = [`[${embedding.join(",")}]`, minScore, minImportance];

    if (agentName) { sql += ` AND agent_name = $${params.length + 1}`; params.push(agentName); }
    if (type)      { sql += ` AND type = $${params.length + 1}`;        params.push(type);      }

    sql += ` ORDER BY score DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const { rows } = await this.pool.query(sql, params);

    // Update access metadata asynchronously
    if (rows.length > 0) {
      const ids = rows.map((r: any) => r.id);
      this.pool.query(
        `UPDATE agent_memories
         SET access_count = access_count + 1, last_accessed_at = NOW()
         WHERE id = ANY($1::uuid[])`,
        [ids]
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

  /**
   * Returns a formatted memory context block to inject into an agent's system prompt.
   * Retrieves top-k relevant memories for the given agent + current task.
   */
  async getContextFor(agentName: string, task: string, limit = 5): Promise<string> {
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
    params.push(id);
    await this.pool.query(
      `UPDATE agent_memories SET ${sets.join(", ")} WHERE id = $${params.length}`,
      params
    );
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM agent_memories WHERE id = $1`, [id]);
    logger.debug("[memory-manager] deleted", { id });
  }

  // ── Consolidate ───────────────────────────────────────────────────────────────

  /**
   * Finds near-duplicate memories (cosine > DUPLICATE_THRESHOLD) and removes the
   * lower-importance duplicate, preserving the higher-importance one.
   * Returns counts of what changed.
   */
  async consolidate(agentName?: string): Promise<ConsolidationResult> {
    let sql = `
      SELECT a.id AS id_a, b.id AS id_b,
             a.importance AS imp_a, b.importance AS imp_b,
             1 - (a.embedding <=> b.embedding) AS similarity
      FROM agent_memories a
      JOIN agent_memories b ON a.id < b.id
        AND 1 - (a.embedding <=> b.embedding) > $1
    `;
    const params: unknown[] = [DUPLICATE_THRESHOLD];

    if (agentName) {
      sql += ` AND a.agent_name = $2 AND b.agent_name = $2`;
      params.push(agentName);
    }

    const { rows } = await this.pool.query(sql, params);

    let merged = 0;
    const toDelete = new Set<string>();

    for (const row of rows) {
      if (toDelete.has(row.id_a) || toDelete.has(row.id_b)) continue;
      // Keep higher importance, delete the other
      const deleteId = row.imp_a >= row.imp_b ? row.id_b : row.id_a;
      toDelete.add(deleteId);
      merged++;
    }

    for (const id of toDelete) {
      await this.delete(id);
    }

    const { rows: remaining } = await this.pool.query(
      agentName
        ? `SELECT COUNT(*) FROM agent_memories WHERE agent_name = $1`
        : `SELECT COUNT(*) FROM agent_memories`,
      agentName ? [agentName] : []
    );

    logger.info("[memory-manager] consolidate done", { merged, kept: Number(remaining[0].count) });
    return { merged, kept: Number(remaining[0].count), removed: merged };
  }

  // ── Prune ─────────────────────────────────────────────────────────────────────

  /**
   * Removes low-value memories: importance < threshold AND accessCount < threshold
   * AND older than N days.
   */
  async prune(agentName?: string): Promise<number> {
    const cutoff = new Date(Date.now() - PRUNE_MAX_AGE_DAYS * 86_400_000).toISOString();
    let sql = `
      DELETE FROM agent_memories
      WHERE importance < $1
        AND access_count < $2
        AND created_at < $3
    `;
    const params: unknown[] = [PRUNE_MIN_IMPORTANCE, PRUNE_MIN_ACCESS, cutoff];

    if (agentName) {
      sql += ` AND agent_name = $4`;
      params.push(agentName);
    }

    const { rowCount } = await this.pool.query(sql, params);
    logger.info("[memory-manager] pruned", { removed: rowCount, agentName });
    return rowCount ?? 0;
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  async stats(agentName?: string): Promise<Record<string, unknown>> {
    const { rows } = await this.pool.query(
      agentName
        ? `SELECT type, COUNT(*) AS count, AVG(importance) AS avg_importance
           FROM agent_memories WHERE agent_name = $1 GROUP BY type`
        : `SELECT agent_name, type, COUNT(*) AS count, AVG(importance) AS avg_importance
           FROM agent_memories GROUP BY agent_name, type ORDER BY agent_name, type`,
      agentName ? [agentName] : []
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
    await this.pool.end();
  }
}

export const memoryManager = new MemoryManager();
