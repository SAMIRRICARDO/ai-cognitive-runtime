import { readFile, readdir, stat } from "fs/promises";
import { join, relative, extname } from "path";
import { homedir } from "os";
import pg from "pg";
import OpenAI from "openai";
import crypto from "crypto";
import { env } from "../../config/env.js";
import { RedisMemory } from "../short-term/redis.js";
import { logger } from "../../config/logger.js";
import pLimit from "p-limit";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VaultChunk {
  filePath: string;      // relative to vault root
  title: string;         // note title (filename or first H1)
  section: string;       // heading path, e.g. "Intro > Key Points"
  content: string;       // chunk text
  tags: string[];        // frontmatter tags + inline #tags
  links: string[];       // [[wikilinks]] found in chunk
  mtime: number;         // file modification time (ms)
  chunkIndex: number;
}

export interface SearchResult extends VaultChunk {
  score: number;
  id: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS  = 1536;
const CHUNK_MAX_CHARS = 1200;   // ~300 tokens — sweet spot for retrieval
const CHUNK_OVERLAP   = 150;    // chars of overlap between adjacent chunks
const EMBED_CONCURRENCY = 8;    // parallel embedding requests
const EMBED_CACHE_TTL   = 86_400 * 7; // 7 days

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolvePath(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

function extractFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const [k, ...v] = line.split(":");
    if (k && v.length) meta[k.trim()] = v.join(":").trim();
  }
  return { meta, body: match[2] };
}

function extractTags(meta: Record<string, unknown>, text: string): string[] {
  const fmTags = meta["tags"]
    ? String(meta["tags"]).replace(/[\[\]]/g, "").split(/[,\s]+/).filter(Boolean)
    : [];
  const inlineTags = [...text.matchAll(/#([\w/-]+)/g)].map((m) => m[1]);
  return [...new Set([...fmTags, ...inlineTags])];
}

function extractLinks(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map((m) => m[1].trim());
}

function chunkNote(title: string, body: string): Array<{ section: string; content: string }> {
  const chunks: Array<{ section: string; content: string }> = [];

  const sections = body.split(/(?=^#{1,4}\s)/m).filter((s) => s.trim());

  for (const section of sections) {
    const headingMatch = section.match(/^(#{1,4})\s+(.+)/);
    const sectionName = headingMatch ? headingMatch[2].trim() : title;
    const sectionBody = headingMatch ? section.slice(section.indexOf("\n") + 1) : section;

    const paragraphs = sectionBody.split(/\n{2,}/);
    let current = "";

    for (const para of paragraphs) {
      const candidate = current ? current + "\n\n" + para : para;

      if (candidate.length <= CHUNK_MAX_CHARS) {
        current = candidate;
      } else {
        if (current.trim()) {
          chunks.push({ section: sectionName, content: current.trim() });
          current = current.slice(-CHUNK_OVERLAP) + "\n\n" + para;
        } else {
          for (let i = 0; i < para.length; i += CHUNK_MAX_CHARS - CHUNK_OVERLAP) {
            chunks.push({ section: sectionName, content: para.slice(i, i + CHUNK_MAX_CHARS).trim() });
          }
          current = "";
        }
      }
    }

    if (current.trim()) {
      chunks.push({ section: sectionName, content: current.trim() });
    }
  }

  return chunks.filter((c) => c.content.length > 80);
}

// ─── Embedding cache (Redis) ──────────────────────────────────────────────────

const redis = new RedisMemory();

async function getCachedEmbedding(text: string): Promise<number[] | null> {
  const key = "embed:" + crypto.createHash("sha256").update(text).digest("hex").slice(0, 24);
  const cached = await redis.get(key).catch(() => null);
  return cached ? (JSON.parse(cached) as number[]) : null;
}

async function setCachedEmbedding(text: string, embedding: number[]): Promise<void> {
  const key = "embed:" + crypto.createHash("sha256").update(text).digest("hex").slice(0, 24);
  await redis.set(key, JSON.stringify(embedding), EMBED_CACHE_TTL).catch(() => {});
}

// ─── VaultIndex ───────────────────────────────────────────────────────────────

export class VaultIndex {
  private pool: pg.Pool | null = null;
  private openai: OpenAI | null = null;
  private vaultRoot: string;

  constructor() {
    this.vaultRoot = resolvePath(env.VAULT_PATH);

    if (env.ENABLE_MEMORY !== "false") {
      if (!env.DATABASE_URL) throw new Error("DATABASE_URL required for VaultIndex");
      if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required for embeddings");
      this.pool = new pg.Pool({ connectionString: env.DATABASE_URL });
      this.openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    }
  }

  // ── Schema ──────────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    const pool = this.pool;
    if (!pool) return;

    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vault_chunks (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        file_path    TEXT NOT NULL,
        title        TEXT NOT NULL,
        section      TEXT NOT NULL DEFAULT '',
        content      TEXT NOT NULL,
        tags         TEXT[] DEFAULT '{}',
        links        TEXT[] DEFAULT '{}',
        mtime        BIGINT NOT NULL DEFAULT 0,
        chunk_index  INT NOT NULL DEFAULT 0,
        embedding    vector(${EMBEDDING_DIMS}),
        fts          TSVECTOR GENERATED ALWAYS AS (
                       to_tsvector('english', coalesce(title,'') || ' ' || coalesce(section,'') || ' ' || coalesce(content,''))
                     ) STORED,
        indexed_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS vault_chunks_embedding_idx
        ON vault_chunks USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS vault_chunks_file_idx ON vault_chunks (file_path)`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS vault_chunks_fts_idx ON vault_chunks USING GIN (fts)`
    );
    logger.info("[vault] schema ready");
  }

  // ── Embedding ───────────────────────────────────────────────────────────────

  async embed(text: string): Promise<number[]> {
    const openai = this.openai;
    if (!openai) return [];

    const cached = await getCachedEmbedding(text);
    if (cached) return cached;

    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000),
    });

    const embedding = response.data[0].embedding;
    await setCachedEmbedding(text, embedding);
    return embedding;
  }

  // ── Indexing ─────────────────────────────────────────────────────────────────

  async indexVault(options: { force?: boolean } = {}): Promise<{ indexed: number; skipped: number; deleted: number }> {
    const pool = this.pool;
    if (!pool) {
      logger.warn("[vault] indexing skipped — memory disabled");
      return { indexed: 0, skipped: 0, deleted: 0 };
    }

    const files = await this.walkVault();
    const limit = pLimit(EMBED_CONCURRENCY);
    let indexed = 0, skipped = 0;

    logger.info(`[vault] found ${files.length} markdown files`);

    const results = await Promise.all(
      files.map((f) => limit(() => this.indexFile(f, options.force ?? false)))
    );

    for (const r of results) {
      if (r === "indexed") indexed++;
      else skipped++;
    }

    const currentPaths = files.map((f) => relative(this.vaultRoot, f));
    const { rowCount } = await pool.query(
      `DELETE FROM vault_chunks WHERE file_path != ALL($1::text[])`,
      [currentPaths]
    );
    const deleted = rowCount ?? 0;

    logger.info(`[vault] indexing done`, { indexed, skipped, deleted });
    return { indexed, skipped, deleted };
  }

  private async indexFile(absPath: string, force: boolean): Promise<"indexed" | "skipped"> {
    const pool = this.pool;
    if (!pool) return "skipped";

    const filePath = relative(this.vaultRoot, absPath);
    const fileStat = await stat(absPath);
    const mtime = Number.isFinite(fileStat.mtimeMs)
      ? Math.floor(fileStat.mtimeMs)
      : Date.now();

    if (!force) {
      const { rows } = await pool.query(
        `SELECT mtime FROM vault_chunks WHERE file_path = $1 LIMIT 1`,
        [filePath]
      );
      if (rows[0]?.mtime >= mtime) return "skipped";
    }

    const raw = await readFile(absPath, "utf8");
    const { meta, body } = extractFrontmatter(raw);
    const fileTitle = String(meta["title"] ?? filePath.replace(/\.md$/, "").split("/").pop());
    const tags = extractTags(meta, body);
    const links = extractLinks(body);
    const rawChunks = chunkNote(fileTitle, body);

    await pool.query(`DELETE FROM vault_chunks WHERE file_path = $1`, [filePath]);

    for (let i = 0; i < rawChunks.length; i++) {
      const { section, content } = rawChunks[i];
      const textToEmbed = `${fileTitle}\n${section}\n\n${content}`;
      const embedding = await this.embed(textToEmbed);

      await pool.query(
        `INSERT INTO vault_chunks
           (file_path, title, section, content, tags, links, mtime, chunk_index, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          filePath,
          fileTitle,
          section,
          content,
          tags,
          links,
          mtime,
          i,
          `[${embedding.join(",")}]`,
        ]
      );
    }

    logger.debug(`[vault] indexed ${filePath} (${rawChunks.length} chunks)`);
    return "indexed";
  }

  private async walkVault(): Promise<string[]> {
    const files: string[] = [];

    async function walk(dir: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (extname(entry.name) === ".md") {
          files.push(full);
        }
      }
    }

    await walk(this.vaultRoot);
    return files;
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  async search(
    query: string,
    options: { limit?: number; tags?: string[]; minScore?: number } = {}
  ): Promise<SearchResult[]> {
    const pool = this.pool;
    if (!pool) return [];

    const { limit = 8, tags, minScore = 0.3 } = options;
    const queryEmbedding = await this.embed(query);
    if (queryEmbedding.length === 0) return [];

    let sql = `
      SELECT id, file_path, title, section, content, tags, links, mtime, chunk_index,
             1 - (embedding <=> $1::vector) AS score
      FROM vault_chunks
      WHERE 1 - (embedding <=> $1::vector) >= $2
    `;
    const params: unknown[] = [`[${queryEmbedding.join(",")}]`, minScore];

    if (tags && tags.length > 0) {
      sql += ` AND tags && $${params.length + 1}::text[]`;
      params.push(tags);
    }

    sql += ` ORDER BY embedding <=> $1::vector LIMIT $${params.length + 1}`;
    params.push(limit);

    const { rows } = await pool.query(sql, params);

    return rows.map((r) => ({
      id: r.id,
      filePath: r.file_path,
      title: r.title,
      section: r.section,
      content: r.content,
      tags: r.tags,
      links: r.links,
      mtime: Number(r.mtime),
      chunkIndex: r.chunk_index,
      score: Number(r.score),
    }));
  }

  async hybridSearch(
    query: string,
    options: {
      limit?: number;
      tags?: string[];
      minScore?: number;
      weights?: { semantic?: number; keyword?: number; recency?: number };
    } = {}
  ): Promise<SearchResult[]> {
    const pool = this.pool;
    if (!pool) return [];

    const { limit = 8, tags, minScore = 0.1 } = options;
    const { semantic = 0.6, keyword = 0.3, recency = 0.1 } = options.weights ?? {};

    const queryEmbedding = await this.embed(query);
    if (queryEmbedding.length === 0) return [];

    const nowMs = Date.now();
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;

    let sql = `
      WITH semantic AS (
        SELECT id,
               1 - (embedding <=> $1::vector) AS sem_score
        FROM vault_chunks
      ),
      keyword AS (
        SELECT id,
               ts_rank_cd(fts, plainto_tsquery('english', $2)) AS kw_score
        FROM vault_chunks
        WHERE fts @@ plainto_tsquery('english', $2)
      ),
      combined AS (
        SELECT
          vc.id, vc.file_path, vc.title, vc.section, vc.content,
          vc.tags, vc.links, vc.mtime, vc.chunk_index,
          COALESCE(s.sem_score, 0) AS sem_score,
          COALESCE(k.kw_score, 0) AS kw_score,
          GREATEST(0, 1.0 - (($3::bigint - vc.mtime)::float / $4::float)) AS rec_score
        FROM vault_chunks vc
        LEFT JOIN semantic  s ON s.id = vc.id
        LEFT JOIN keyword   k ON k.id = vc.id
        WHERE COALESCE(s.sem_score, 0) > 0 OR k.kw_score IS NOT NULL
    `;
    const params: unknown[] = [
      `[${queryEmbedding.join(",")}]`,
      query,
      nowMs,
      oneYearMs,
    ];

    if (tags && tags.length > 0) {
      sql += ` AND vc.tags && $${params.length + 1}::text[]`;
      params.push(tags);
    }

    sql += `
      ),
      scored AS (
        SELECT *,
               ($${params.length + 1}::float * sem_score +
                $${params.length + 2}::float * kw_score  +
                $${params.length + 3}::float * rec_score) AS score
        FROM combined
      )
      SELECT * FROM scored
      WHERE score >= $${params.length + 4}
      ORDER BY score DESC
      LIMIT $${params.length + 5}
    `;
    params.push(semantic, keyword, recency, minScore, limit);

    const { rows } = await pool.query(sql, params);

    return rows.map((r) => ({
      id: r.id,
      filePath: r.file_path,
      title: r.title,
      section: r.section,
      content: r.content,
      tags: r.tags,
      links: r.links,
      mtime: Number(r.mtime),
      chunkIndex: r.chunk_index,
      score: Number(r.score),
    }));
  }

  async stats(): Promise<{ totalChunks: number; totalFiles: number; lastIndexed: string }> {
    const pool = this.pool;
    if (!pool) return { totalChunks: 0, totalFiles: 0, lastIndexed: "never" };

    const { rows } = await pool.query(`
      SELECT COUNT(*) AS total_chunks,
             COUNT(DISTINCT file_path) AS total_files,
             MAX(indexed_at) AS last_indexed
      FROM vault_chunks
    `);
    return {
      totalChunks: Number(rows[0].total_chunks),
      totalFiles: Number(rows[0].total_files),
      lastIndexed: rows[0].last_indexed ?? "never",
    };
  }

  async close(): Promise<void> {
    if (this.pool) await this.pool.end();
  }
}

export const vaultIndex = new VaultIndex();
