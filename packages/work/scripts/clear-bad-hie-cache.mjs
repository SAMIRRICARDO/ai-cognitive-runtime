// scripts/clear-bad-hie-cache.mjs
// Limpa entradas corrompidas do cache HIE (score=13, ip=10%)
// causadas por CHEAP_MAX_OUTPUT_TOKENS=300 na rodada noturna 21/07/2026.
// Após limpeza, o próximo hunt re-escora com 600 tokens (fix já aplicado).

import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../.vraxia-work/work.db');

if (!fs.existsSync(DB_PATH)) {
  console.error('DB não encontrado:', DB_PATH);
  process.exit(1);
}

const SQL = await initSqlJs();
const buf = fs.readFileSync(DB_PATH);
const db  = new SQL.Database(buf);

// Conta entradas afetadas antes de deletar
const before = db.exec(`SELECT COUNT(*) FROM hire_scores WHERE hire_score <= 15 AND interview_probability <= 12`);
const count  = before[0]?.values?.[0]?.[0] ?? 0;
console.log(`[HIE Cache Cleanup] Entradas corrompidas encontradas: ${count}`);

if (count === 0) {
  console.log('[HIE Cache Cleanup] Nada a limpar.');
  db.close();
  process.exit(0);
}

// Mostra amostra das entradas que serão removidas
const sample = db.exec(`
  SELECT job_id, twin_id, hire_score, interview_probability, action, scored_at
  FROM hire_scores WHERE hire_score <= 15 AND interview_probability <= 12
  ORDER BY scored_at DESC LIMIT 10
`);
if (sample.length) {
  console.log('[HIE Cache Cleanup] Amostra das entradas a remover:');
  const cols = sample[0].columns;
  sample[0].values.forEach(row => {
    const obj = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
    console.log(`  ${obj.job_id} | twin=${obj.twin_id} | HS=${obj.hire_score} | IP=${obj.interview_probability}% | ${String(obj.scored_at).slice(0,19)}`);
  });
}

// Remove as entradas corrompidas
db.run(`DELETE FROM hire_scores WHERE hire_score <= 15 AND interview_probability <= 12`);

// Salva DB
fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
db.close();

console.log(`[HIE Cache Cleanup] ✅ ${count} entradas removidas. Próximo hunt rescora com 600 tokens.`);
