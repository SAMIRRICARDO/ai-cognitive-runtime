// packages/work/src/cli/reset-errors.ts
// Reseta registros com status='error' de volta para 'queued' para nova tentativa.
// Uso: tsx src/cli/reset-errors.ts [--dry-run] [--all]
//   --dry-run : apenas lista o que seria resetado, sem alterar o banco
//   --all     : inclui os 3 registros com notas (default: só os sem notas)

import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { program } from 'commander';

program
  .option('--dry-run', 'Lista registros sem alterar o banco')
  .option('--all', 'Inclui registros com notas (TimeoutError etc.)')
  .parse();

const opts = program.opts();

async function main() {
  const DB_PATH = path.resolve(process.cwd(), '.vraxia-work', 'work.db');

  if (!fs.existsSync(DB_PATH)) {
    console.error(`Banco não encontrado: ${DB_PATH}`);
    process.exit(1);
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(DB_PATH));

  const whereClause = opts.all
    ? "WHERE status = 'error'"
    : "WHERE status = 'error' AND notes IS NULL";

  const candidates = db.exec(
    `SELECT id, job_title, company, notes, updated_at
     FROM job_applications ${whereClause}
     ORDER BY updated_at DESC`,
  );

  if (!candidates.length || !candidates[0].values.length) {
    console.log('Nenhum registro com status=error encontrado.');
    db.close();
    return;
  }

  const rows = candidates[0].values;
  console.log(`\n${opts.dryRun ? '[DRY RUN] ' : ''}Registros encontrados: ${rows.length}\n`);

  for (const [id, title, company, notes, updatedAt] of rows) {
    const reason = notes ? `notas: ${String(notes).slice(0, 80)}` : 'sem notas';
    console.log(`  ${id} — ${String(title).slice(0, 50)} @ ${company}`);
    console.log(`         ${updatedAt} | ${reason}\n`);
  }

  if (opts.dryRun) {
    console.log('[DRY RUN] Nenhuma alteração feita. Remova --dry-run para aplicar.');
    db.close();
    return;
  }

  const now = new Date().toISOString();
  db.run(`
    UPDATE job_applications
    SET status            = 'queued',
        application_state = 'queued',
        notes             = NULL,
        trace_id          = NULL,
        evidence_dir      = NULL,
        error_category    = NULL,
        error_rca         = NULL,
        confidence        = 'UNKNOWN',
        validation_score  = 0,
        updated_at        = ?
    ${whereClause}
  `, [now]);

  const changed = db.exec(`SELECT changes()`);
  const count = changed[0]?.values?.[0]?.[0] ?? 0;

  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  db.close();

  console.log(`✅ ${count} registro(s) resetado(s) para 'queued'. Serão retentados na próxima execução do hunt.`);
}

main().catch(err => { console.error(err); process.exit(1); });
