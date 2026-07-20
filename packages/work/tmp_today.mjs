import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
const SQL = await initSqlJs();
const dbPath = path.resolve('.vraxia-work/work.db');
const buf = fs.readFileSync(dbPath);
const db = new SQL.Database(buf);

// Qualquer atividade hoje (qualquer status)
const r = db.exec(`
  SELECT job_title, company, status, score_action, applied_at, updated_at, platform
  FROM job_applications
  WHERE date(updated_at) >= '2026-07-17'
  ORDER BY updated_at DESC
  LIMIT 50
`);
console.log('=== ATIVIDADE DESDE 17/07 ===');
if (r.length) {
  const cols = r[0].columns;
  for (const row of r[0].values) {
    const obj = {};
    cols.forEach((c,i) => { obj[c]=row[i]; });
    console.log(JSON.stringify(obj));
  }
} else { console.log('nenhuma atividade'); }

// Mais recente updated_at geral
const latest = db.exec(`SELECT MAX(updated_at) FROM job_applications`);
console.log('\nMais recente updated_at:', latest[0].values[0][0]);

// Status queued (candidaturas pendentes de envio)
const queued = db.exec(`SELECT COUNT(*) FROM job_applications WHERE status='queued'`);
console.log('Queued (pendente):', queued[0].values[0][0]);

db.close();
