#!/usr/bin/env tsx
/**
 * import-memories.ts — Import pgvector memories from JSON export
 *
 * Usage:
 *   tsx scripts/import-memories.ts --input <path> [--dry-run] [--skip-existing]
 *
 * Examples:
 *   tsx scripts/import-memories.ts --input ./backups/postgres/memories-2026-05-19.json
 *   tsx scripts/import-memories.ts --input ./memories.json --dry-run
 *   tsx scripts/import-memories.ts --input ./memories.json --skip-existing
 */
import { existsSync, readFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = resolve(__dirname, "..");

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const flag    = (f: string) => args.includes(f);
const flagVal = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };

const INPUT         = flagVal("--input");
const DRY_RUN       = flag("--dry-run");
const SKIP_EXISTING = flag("--skip-existing");

// ─── Colors ───────────────────────────────────────────────────────────────────

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  ok:   (s: string) => USE_COLOR ? `\x1b[32m✓\x1b[0m ${s}` : `✓ ${s}`,
  fail: (s: string) => USE_COLOR ? `\x1b[31m✗\x1b[0m ${s}` : `✗ ${s}`,
  skip: (s: string) => USE_COLOR ? `\x1b[33m⊘\x1b[0m ${s}` : `⊘ ${s}`,
  info: (s: string) => USE_COLOR ? `\x1b[36m→\x1b[0m ${s}` : `→ ${s}`,
  bold: (s: string) => USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s,
  dim:  (s: string) => USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s,
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemoryExport {
  exportedAt: string;
  filters: { agent?: string; type?: string };
  count: number;
  memories: Array<{
    id: string;
    type: string;
    content: string;
    context: string;
    agentName: string;
    importance: number;
    accessCount: number;
    tags: string[];
    createdAt: string;
    lastAccessedAt: string;
  }>;
}

// ─── Embedding ────────────────────────────────────────────────────────────────

async function embed(openai: OpenAI, text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 8000),
  });
  return res.data[0].embedding;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${c.bold("AI Cognitive Runtime — Memory Import")}`);

  if (!INPUT) {
    console.error(c.fail("--input <path> is required"));
    console.log("  Usage: tsx scripts/import-memories.ts --input <path>");
    process.exit(1);
  }

  const inputPath = resolve(INPUT);
  if (!existsSync(inputPath)) {
    console.error(c.fail(`File not found: ${inputPath}`));
    process.exit(1);
  }

  // Load env
  const { config } = await import("dotenv");
  config({ path: join(ROOT, ".env") });

  const enableMemory = process.env.ENABLE_MEMORY;
  const databaseUrl  = process.env.DATABASE_URL;
  const openaiKey    = process.env.OPENAI_API_KEY;

  if (enableMemory === "false") {
    console.log(c.fail("ENABLE_MEMORY=false — memory system is disabled."));
    process.exit(0);
  }

  if (!databaseUrl) { console.error(c.fail("DATABASE_URL not set")); process.exit(1); }
  if (!openaiKey)   { console.error(c.fail("OPENAI_API_KEY not set (needed for embeddings)")); process.exit(1); }

  // Parse export file
  process.stdout.write(c.info(`Reading ${inputPath}... `));
  let data: MemoryExport;
  try {
    data = JSON.parse(readFileSync(inputPath, "utf8")) as MemoryExport;
    console.log(c.ok(`${data.count} memories (exported ${new Date(data.exportedAt).toLocaleDateString("pt-BR")})`));
  } catch (err) {
    console.log(c.fail(`parse error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  if (data.memories.length === 0) {
    console.log(c.dim("  No memories in export file."));
    return;
  }

  if (DRY_RUN) {
    console.log(`\n${c.bold("[DRY RUN — no data will be written]")}`);
    console.log(c.dim(`  Would import: ${data.memories.length} memories`));
    data.memories.slice(0, 5).forEach(m => {
      console.log(c.dim(`  [${m.type}] ${m.agentName}: ${m.content.slice(0, 80)}...`));
    });
    if (data.memories.length > 5) console.log(c.dim(`  ... and ${data.memories.length - 5} more`));
    return;
  }

  // Connect
  const pool  = new pg.Pool({ connectionString: databaseUrl });
  const openai = new OpenAI({ apiKey: openaiKey });

  process.stdout.write(c.info("Connecting to PostgreSQL... "));
  try { await pool.query("SELECT 1"); console.log(c.ok("connected")); }
  catch (err) {
    console.log(c.fail(`failed: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  // Ensure schema exists
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_memories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type TEXT NOT NULL, content TEXT NOT NULL, context TEXT NOT NULL DEFAULT '',
      agent_name TEXT NOT NULL DEFAULT '', importance FLOAT NOT NULL DEFAULT 0.5,
      access_count INT NOT NULL DEFAULT 0, tags TEXT[] DEFAULT '{}',
      embedding vector(1536), created_at TIMESTAMPTZ DEFAULT NOW(),
      last_accessed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Import loop
  let imported = 0, skipped = 0, failed = 0;
  console.log(c.info(`Importing ${data.memories.length} memories (this may take a while — embeddings are generated)...`));

  for (let i = 0; i < data.memories.length; i++) {
    const m = data.memories[i];
    process.stdout.write(`\r  [${i + 1}/${data.memories.length}] ${m.agentName}: ${m.content.slice(0, 50).padEnd(50)}`);

    try {
      if (SKIP_EXISTING) {
        const exists = await pool.query("SELECT 1 FROM agent_memories WHERE id = $1", [m.id]);
        if (exists.rowCount && exists.rowCount > 0) { skipped++; continue; }
      }

      const embedding = await embed(openai, m.content);

      await pool.query(
        `INSERT INTO agent_memories
           (id, type, content, context, agent_name, importance, access_count, tags, embedding, created_at, last_accessed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::vector,$10,$11)
         ON CONFLICT (id) DO UPDATE SET
           content = EXCLUDED.content, importance = EXCLUDED.importance,
           tags = EXCLUDED.tags, embedding = EXCLUDED.embedding`,
        [
          m.id, m.type, m.content, m.context, m.agentName,
          m.importance, m.accessCount, m.tags,
          `[${embedding.join(",")}]`,
          m.createdAt, m.lastAccessedAt,
        ]
      );
      imported++;
    } catch (err) {
      failed++;
      // Continue on individual failures
    }

    // Small delay to avoid OpenAI rate limiting
    if (i > 0 && i % 10 === 0) await new Promise<void>(r => setTimeout(r, 500));
  }

  process.stdout.write("\n");
  await pool.end();

  console.log(`\n${c.bold("Import complete")}`);
  console.log(c.ok(`Imported:  ${imported}`));
  if (skipped > 0) console.log(c.skip(`Skipped:   ${skipped} (already existed)`));
  if (failed > 0)  console.log(c.fail(`Failed:    ${failed}`));
  console.log();
}

main().catch(err => { console.error(c.fail(String(err))); process.exit(1); });
