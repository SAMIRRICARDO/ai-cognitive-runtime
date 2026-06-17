/**
 * Aplica as migrations SQL do diretório infra/postgres/migrations/
 * em ordem numérica. Seguro para re-execução (IF NOT EXISTS em todos os DDLs).
 *
 * Uso: npm run db:migrate
 */

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

if (!env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const migrationsDir = path.resolve("infra/postgres/migrations");

const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const file of files) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
  logger.info(`[migration] applying ${file}`);
  await pool.query(sql);
  logger.info(`[migration] done: ${file}`);
}

await pool.end();
console.log(`\n✅ ${files.length} migration(s) aplicada(s) com sucesso.\n`);
