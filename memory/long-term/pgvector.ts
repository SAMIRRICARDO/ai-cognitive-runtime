import pg from "pg";
import { env } from "../../config/env.js";

export interface Document {
  id?: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
}

export class VectorStore {
  private pool: pg.Pool;

  constructor() {
    if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required for VectorStore");
    this.pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  }

  async initialize(): Promise<void> {
    await this.pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        content TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        embedding vector(1536),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS documents_embedding_idx ON documents USING ivfflat (embedding vector_cosine_ops)`
    );
  }

  async insert(doc: Document): Promise<string> {
    const { rows } = await this.pool.query(
      `INSERT INTO documents (content, metadata, embedding) VALUES ($1, $2, $3) RETURNING id`,
      [doc.content, JSON.stringify(doc.metadata), doc.embedding ? `[${doc.embedding.join(",")}]` : null]
    );
    return rows[0].id;
  }

  async similaritySearch(embedding: number[], limit = 5): Promise<Document[]> {
    const { rows } = await this.pool.query(
      `SELECT id, content, metadata, 1 - (embedding <=> $1) AS score
       FROM documents
       ORDER BY embedding <=> $1
       LIMIT $2`,
      [`[${embedding.join(",")}]`, limit]
    );
    return rows;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
