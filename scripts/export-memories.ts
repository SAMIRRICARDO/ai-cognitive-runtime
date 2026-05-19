#!/usr/bin/env tsx
/**
 * export-memories.ts — Export pgvector memories to JSON
 *
 * Usage:
 *   tsx scripts/export-memories.ts [--output <path>] [--agent <name>] [--type episodic|semantic|procedural]
 *
 * Examples:
 *   tsx scripts/export-memories.ts
 *   tsx scripts/export-memories.ts --output ./backups/memories-export.json
 *   tsx scripts/export-memories.ts --agent outreach-agent --type semantic
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = resolve(__dirname, "..");

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const flagVal = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };

const AGENT_FILTER = flagVal("--agent");
const TYPE_FILTER  = flagVal("--type");

const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
const DEFAULT_OUTPUT = join(ROOT, "backups", "postgres", `memories-${ts}.json`);
const OUTPUT_PATH    = resolve(flagVal("--output") ?? DEFAULT_OUTPUT);

// ─── Colors ───────────────────────────────────────────────────────────────────

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  ok:   (s: string) => USE_COLOR ? `\x1b[32m✓\x1b[0m ${s}` : `✓ ${s}`,
  fail: (s: string) => USE_COLOR ? `\x1b[31m✗\x1b[0m ${s}` : `✗ ${s}`,
  info: (s: string) => USE_COLOR ? `\x1b[36m→\x1b[0m ${s}` : `→ ${s}`,
  bold: (s: string) => USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s,
  dim:  (s: string) => USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s,
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${c.bold("AI Cognitive Runtime — Memory Export")}`);

  // Load env
  const { config } = await import("dotenv");
  config({ path: join(ROOT, ".env") });

  const enableMemory = process.env.ENABLE_MEMORY;
  const databaseUrl  = process.env.DATABASE_URL;

  if (enableMemory === "false") {
    console.log(c.fail("ENABLE_MEMORY=false — memory system is disabled."));
    console.log(c.dim("  Set ENABLE_MEMORY=true and DATABASE_URL to enable memory exports."));
    process.exit(0);
  }

  if (!databaseUrl) {
    console.log(c.fail("DATABASE_URL not set in .env"));
    process.exit(1);
  }

  // Connect to PostgreSQL
  const pool = new pg.Pool({ connectionString: databaseUrl });

  process.stdout.write(c.info("Connecting to PostgreSQL... "));
  try {
    await pool.query("SELECT 1");
    console.log(c.ok("connected"));
  } catch (err) {
    console.log(c.fail(`connection failed: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  // Build query
  let sql = `
    SELECT id, type, content, context, agent_name, importance,
           access_count, tags, created_at, last_accessed_at
    FROM agent_memories
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (AGENT_FILTER) {
    params.push(AGENT_FILTER);
    sql += ` AND agent_name = $${params.length}`;
  }
  if (TYPE_FILTER) {
    params.push(TYPE_FILTER);
    sql += ` AND type = $${params.length}`;
  }

  sql += " ORDER BY created_at DESC";

  process.stdout.write(c.info(`Querying memories${AGENT_FILTER ? ` (agent: ${AGENT_FILTER})` : ""}${TYPE_FILTER ? ` (type: ${TYPE_FILTER})` : ""}... `));

  let rows: any[] = [];
  try {
    const result = await pool.query(sql, params);
    rows = result.rows;
    console.log(c.ok(`${rows.length} memories found`));
  } catch (err) {
    console.log(c.fail(`query failed: ${err instanceof Error ? err.message : String(err)}`));
    await pool.end();
    process.exit(1);
  }

  if (rows.length === 0) {
    console.log(c.dim("  No memories to export."));
    await pool.end();
    return;
  }

  // Build export object
  const exportData = {
    exportedAt: new Date().toISOString(),
    filters: { agent: AGENT_FILTER, type: TYPE_FILTER },
    count: rows.length,
    memories: rows.map(r => ({
      id:             r.id,
      type:           r.type,
      content:        r.content,
      context:        r.context,
      agentName:      r.agent_name,
      importance:     Number(r.importance),
      accessCount:    Number(r.access_count),
      tags:           r.tags,
      createdAt:      r.created_at,
      lastAccessedAt: r.last_accessed_at,
    })),
  };

  // Write output
  process.stdout.write(c.info(`Writing to ${OUTPUT_PATH}... `));
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(exportData, null, 2), "utf8");
  const sizeKb = Math.round(Buffer.byteLength(JSON.stringify(exportData)) / 1024);
  console.log(c.ok(`${sizeKb} KB`));

  await pool.end();

  console.log(`\n${c.bold("Export complete")}`);
  console.log(c.dim(`  File:  ${OUTPUT_PATH}`));
  console.log(c.dim(`  Count: ${rows.length} memories`));
  console.log(c.dim(`  To restore: tsx scripts/import-memories.ts --input "${OUTPUT_PATH}"`));
  console.log();
}

main().catch(err => { console.error(c.fail(String(err))); process.exit(1); });
