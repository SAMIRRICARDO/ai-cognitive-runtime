import Anthropic from "@anthropic-ai/sdk";
import pg from "pg";
import { env } from "../config/env.js";
import { Models } from "../config/models.js";
import { logger } from "../config/logger.js";
import { memoryManager, type MemorySearchResult } from "./manager.js";
import { calculateCost } from "../config/costs.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Episode {
  id: string;
  agentName: string;
  startedAt: string;
  endedAt: string | null;
  memoryCount: number;
  summary: string | null;
}

export interface CompressionResult {
  clustersFound: number;
  memoriesCompressed: number;
  memoriesCreated: number;
  tokenCost: number;
}

export interface SummarizationResult {
  episodesSummarized: number;
  memoriesMerged: number;
  rollingSummaryUpdated: boolean;
  tokenCost: number;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const CLUSTER_THRESHOLD = 0.78;
const EPISODE_SUMMARY_THRESHOLD = 8;
const ROLLING_WINDOW = 6;
const MIN_CLUSTER_SIZE = 2;

// ─── MemoryCompressor ─────────────────────────────────────────────────────────

export class MemoryCompressor {
  private client: Anthropic;
  private pool: pg.Pool | null = null;

  constructor() {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    if (env.ENABLE_MEMORY !== "false") {
      if (!env.DATABASE_URL) throw new Error("DATABASE_URL required");
      this.pool = new pg.Pool({ connectionString: env.DATABASE_URL });
    }
  }

  // ── Schema migration ─────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    const pool = this.pool;
    if (!pool) return;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_episodes (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_name   TEXT NOT NULL,
        started_at   TIMESTAMPTZ DEFAULT NOW(),
        ended_at     TIMESTAMPTZ,
        summary      TEXT,
        memory_count INT DEFAULT 0
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS agent_episodes_agent_idx ON agent_episodes (agent_name)`
    );

    await pool.query(
      `ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS episode_id UUID REFERENCES agent_episodes(id) ON DELETE SET NULL`
    );
    await pool.query(
      `ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS is_summary BOOLEAN NOT NULL DEFAULT FALSE`
    );
    await pool.query(
      `ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS source_ids UUID[] DEFAULT '{}'`
    );

    logger.info("[compressor] schema ready");
  }

  // ── Episode lifecycle ─────────────────────────────────────────────────────────

  async beginEpisode(agentName: string): Promise<string> {
    const pool = this.pool;
    if (!pool) return "";

    const { rows } = await pool.query(
      `INSERT INTO agent_episodes (agent_name) VALUES ($1) RETURNING id`,
      [agentName]
    );
    const id = rows[0].id as string;
    logger.info("[compressor] episode started", { id, agentName });
    return id;
  }

  async endEpisode(episodeId: string): Promise<{ summary: string; tokenCost: number }> {
    const pool = this.pool;
    if (!pool) return { summary: "", tokenCost: 0 };

    const { rows: memories } = await pool.query(
      `SELECT id, content, importance FROM agent_memories
       WHERE episode_id = $1 ORDER BY importance DESC`,
      [episodeId]
    );

    let summary = "";
    let tokenCost = 0;

    if (memories.length > 0) {
      const bullets = memories.map((m: any) => `- ${m.content}`).join("\n");
      const result = await this.callHaiku(
        "Summarize these memories from a single agent session into 2-3 concise sentences. Keep all key facts, decisions, and learnings.",
        bullets
      );
      summary = result.text;
      tokenCost = result.tokenCost;
    }

    await pool.query(
      `UPDATE agent_episodes
       SET ended_at = NOW(), summary = $1, memory_count = $2
       WHERE id = $3`,
      [summary, memories.length, episodeId]
    );

    logger.info("[compressor] episode ended", { episodeId, memories: memories.length });
    return { summary, tokenCost };
  }

  async attachToEpisode(memoryId: string, episodeId: string): Promise<void> {
    const pool = this.pool;
    if (!pool) return;

    await pool.query(
      `UPDATE agent_memories SET episode_id = $1 WHERE id = $2`,
      [episodeId, memoryId]
    );
  }

  // ── Semantic compression ──────────────────────────────────────────────────────

  async compressSemanticClusters(agentName?: string): Promise<CompressionResult> {
    const pool = this.pool;
    if (!pool) return { clustersFound: 0, memoriesCompressed: 0, memoriesCreated: 0, tokenCost: 0 };

    const { rows } = await pool.query(
      agentName
        ? `SELECT id, content, importance, embedding::text FROM agent_memories
           WHERE agent_name = $1 AND is_summary = FALSE ORDER BY importance DESC`
        : `SELECT id, content, importance, embedding::text FROM agent_memories
           WHERE is_summary = FALSE ORDER BY importance DESC`,
      agentName ? [agentName] : []
    );

    if (rows.length < MIN_CLUSTER_SIZE) {
      return { clustersFound: 0, memoriesCompressed: 0, memoriesCreated: 0, tokenCost: 0 };
    }

    const clusters = await this.buildClusters(rows);
    const significantClusters = clusters.filter((c) => c.length >= MIN_CLUSTER_SIZE);

    let memoriesCompressed = 0;
    let memoriesCreated = 0;
    let tokenCost = 0;

    for (const cluster of significantClusters) {
      const result = await this.compressCluster(cluster, agentName ?? "global");
      memoriesCompressed += cluster.length;
      memoriesCreated += 1;
      tokenCost += result.tokenCost;
    }

    logger.info("[compressor] semantic compression done", {
      clustersFound: significantClusters.length,
      memoriesCompressed,
      memoriesCreated,
      tokenCost,
    });

    return { clustersFound: significantClusters.length, memoriesCompressed, memoriesCreated, tokenCost };
  }

  private async buildClusters(
    rows: Array<{ id: string; content: string; importance: number; embedding: string }>
  ): Promise<Array<Array<{ id: string; content: string; importance: number }>>> {
    const embeddings = rows.map((r) => {
      const vals = r.embedding.replace(/[[\]]/g, "").split(",").map(Number);
      return { id: r.id, content: r.content, importance: r.importance, vec: vals };
    });

    const parent = new Map(embeddings.map((e) => [e.id, e.id]));
    const find = (id: string): string => {
      if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
      return parent.get(id)!;
    };
    const union = (a: string, b: string) => parent.set(find(a), find(b));

    for (let i = 0; i < embeddings.length; i++) {
      for (let j = i + 1; j < embeddings.length; j++) {
        const sim = cosineSimilarity(embeddings[i].vec, embeddings[j].vec);
        if (sim >= CLUSTER_THRESHOLD) union(embeddings[i].id, embeddings[j].id);
      }
    }

    const groups = new Map<string, Array<{ id: string; content: string; importance: number }>>();
    for (const e of embeddings) {
      const root = find(e.id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push({ id: e.id, content: e.content, importance: e.importance });
    }

    return [...groups.values()];
  }

  private async compressCluster(
    cluster: Array<{ id: string; content: string; importance: number }>,
    agentName: string
  ): Promise<{ tokenCost: number }> {
    const pool = this.pool;
    if (!pool) return { tokenCost: 0 };

    const sorted = [...cluster].sort((a, b) => b.importance - a.importance);
    const bullets = sorted.map((m) => `- [importance=${m.importance.toFixed(1)}] ${m.content}`).join("\n");

    const { text, tokenCost } = await this.callSonnet(
      "You are compressing a group of related memories into one denser representation. " +
      "Preserve ALL distinct facts, decisions, and nuances from the group. " +
      "Output a single paragraph (2-4 sentences max). Do not lose any unique information.",
      bullets
    );

    const maxImportance = Math.min(1.0, sorted[0].importance + 0.05);
    const allTags = cluster.flatMap(() => [] as string[]);
    const sourceIds = cluster.map((m) => m.id);

    const id = await memoryManager.store({
      type: "semantic",
      content: text,
      context: `compressed from ${cluster.length} related memories`,
      agentName,
      importance: maxImportance,
      tags: [...new Set(allTags)],
    });

    await pool.query(
      `UPDATE agent_memories SET is_summary = TRUE, source_ids = $1 WHERE id = $2`,
      [sourceIds, id]
    );

    await pool.query(
      `DELETE FROM agent_memories WHERE id = ANY($1::uuid[])`,
      [sourceIds]
    );

    return { tokenCost };
  }

  // ── Incremental summarization ─────────────────────────────────────────────────

  async incrementalSummarize(agentName: string): Promise<SummarizationResult> {
    const pool = this.pool;
    if (!pool) return { episodesSummarized: 0, memoriesMerged: 0, rollingSummaryUpdated: false, tokenCost: 0 };

    const { rows: episodic } = await pool.query(
      `SELECT id, content, importance, created_at
       FROM agent_memories
       WHERE agent_name = $1 AND type = 'episodic' AND is_summary = FALSE
       ORDER BY created_at ASC`,
      [agentName]
    );

    if (episodic.length < EPISODE_SUMMARY_THRESHOLD) {
      return { episodesSummarized: 0, memoriesMerged: 0, rollingSummaryUpdated: false, tokenCost: 0 };
    }

    const toSummarize = episodic.slice(0, ROLLING_WINDOW);
    const bullets = toSummarize
      .map((m: any) => `- [${new Date(m.created_at).toLocaleDateString()}] ${m.content}`)
      .join("\n");

    const { rows: existing } = await pool.query(
      `SELECT id, content FROM agent_memories
       WHERE agent_name = $1 AND type = 'episodic' AND is_summary = TRUE
       ORDER BY created_at DESC LIMIT 1`,
      [agentName]
    );

    const priorSummary = existing[0]?.content ?? "";
    const prompt = priorSummary
      ? `Prior summary:\n${priorSummary}\n\nNew episodes to integrate:\n${bullets}`
      : bullets;

    const instruction = priorSummary
      ? "Update the prior summary by integrating the new episodes. Preserve all important context. Output a single updated summary paragraph."
      : "Summarize these episodic memories chronologically. Focus on decisions made, lessons learned, and important context. 3-5 sentences.";

    const { text, tokenCost } = await this.callSonnet(instruction, prompt);

    const sourceIds = toSummarize.map((m: any) => m.id);

    if (existing[0]) {
      await memoryManager.delete(existing[0].id);
    }

    const summaryId = await memoryManager.store({
      type: "episodic",
      content: text,
      context: `rolling summary of ${toSummarize.length} episodes`,
      agentName,
      importance: 0.85,
      tags: ["rolling-summary"],
    });

    await pool.query(
      `UPDATE agent_memories SET is_summary = TRUE, source_ids = $1 WHERE id = $2`,
      [sourceIds, summaryId]
    );

    await pool.query(
      `DELETE FROM agent_memories WHERE id = ANY($1::uuid[])`,
      [sourceIds]
    );

    logger.info("[compressor] incremental summarization done", {
      agentName,
      merged: toSummarize.length,
      rollingSummaryUpdated: !!priorSummary,
    });

    return {
      episodesSummarized: toSummarize.length,
      memoriesMerged: toSummarize.length,
      rollingSummaryUpdated: !!priorSummary,
      tokenCost,
    };
  }

  // ── Cost-aware deduplication ──────────────────────────────────────────────────

  async deduplicateCheap(agentName?: string): Promise<{ removed: number; tokenCost: number }> {
    const pool = this.pool;
    if (!pool) return { removed: 0, tokenCost: 0 };

    const threshold = 0.88;
    const agentFilter = agentName ? `AND a.agent_name = '${agentName}'` : "";

    const { rows: candidates } = await pool.query(`
      SELECT a.id AS id_a, b.id AS id_b, a.content AS content_a, b.content AS content_b,
             a.importance AS imp_a, b.importance AS imp_b,
             1 - (a.embedding <=> b.embedding) AS similarity
      FROM agent_memories a
      JOIN agent_memories b ON a.id < b.id
        AND 1 - (a.embedding <=> b.embedding) > $1
      ${agentFilter}
      ORDER BY similarity DESC
    `, [threshold]);

    let removed = 0;
    let tokenCost = 0;
    const deleted = new Set<string>();

    for (const row of candidates) {
      if (deleted.has(row.id_a) || deleted.has(row.id_b)) continue;

      const { text, tokenCost: tc } = await this.callHaiku(
        'Are these two memories expressing the same fact/event? Answer only "yes" or "no".',
        `Memory A: ${row.content_a}\nMemory B: ${row.content_b}`
      );
      tokenCost += tc;

      if (text.toLowerCase().startsWith("yes")) {
        const deleteId = row.imp_a >= row.imp_b ? row.id_b : row.id_a;
        await memoryManager.delete(deleteId);
        deleted.add(deleteId);
        removed++;
      }
    }

    logger.info("[compressor] dedup done", { candidates: candidates.length, removed, tokenCost });
    return { removed, tokenCost };
  }

  // ── Episode history ───────────────────────────────────────────────────────────

  async getEpisodes(agentName: string, limit = 10): Promise<Episode[]> {
    const pool = this.pool;
    if (!pool) return [];

    const { rows } = await pool.query(
      `SELECT id, agent_name, started_at, ended_at, summary, memory_count
       FROM agent_episodes
       WHERE agent_name = $1
       ORDER BY started_at DESC
       LIMIT $2`,
      [agentName, limit]
    );
    return rows.map((r: any) => ({
      id: r.id,
      agentName: r.agent_name,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      memoryCount: r.memory_count,
      summary: r.summary,
    }));
  }

  // ── LLM helpers ──────────────────────────────────────────────────────────────

  private async callHaiku(
    instruction: string,
    content: string
  ): Promise<{ text: string; tokenCost: number }> {
    const res = await this.client.messages.create({
      model: Models.fast,
      max_tokens: 256,
      system: [{ type: "text", text: instruction, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: content.slice(0, 4000) }],
    });

    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const cost = calculateCost(Models.fast, {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      cacheReadTokens: (res.usage as any).cache_read_input_tokens ?? 0,
      cacheCreationTokens: (res.usage as any).cache_creation_input_tokens ?? 0,
    });
    return { text, tokenCost: cost.totalCost };
  }

  private async callSonnet(
    instruction: string,
    content: string
  ): Promise<{ text: string; tokenCost: number }> {
    const res = await this.client.messages.create({
      model: Models.default,
      max_tokens: 512,
      system: [{ type: "text", text: instruction, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: content.slice(0, 8000) }],
    });

    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const cost = calculateCost(Models.default, {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      cacheReadTokens: (res.usage as any).cache_read_input_tokens ?? 0,
      cacheCreationTokens: (res.usage as any).cache_creation_input_tokens ?? 0,
    });
    return { text, tokenCost: cost.totalCost };
  }

  async close(): Promise<void> {
    if (this.pool) await this.pool.end();
  }
}

// ─── Pure math ────────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const memoryCompressor = new MemoryCompressor();
