import initSqlJs from 'sql.js';
import fs from 'fs';
const SQL = await initSqlJs();
const buf = fs.readFileSync('.vraxia-work/work.db');
const db = new SQL.Database(buf);

// Verificar se há qualquer coisa de Jul 17-20
const r1 = db.exec(`
  SELECT date(updated_at) as dia, COUNT(*) n
  FROM job_applications
  WHERE date(updated_at) >= '2026-07-17'
  GROUP BY dia
`);
console.log('=== REGISTROS >= 17/07 ===');
if (r1.length) for (const row of r1[0].values) console.log(row.join(' | '));
else console.log('NENHUM');

// Verificar o max updated_at
const r2 = db.exec(`SELECT MAX(updated_at) as max_upd, COUNT(*) total FROM job_applications`);
console.log('\n=== MAX updated_at / total ===');
if (r2.length) console.log(r2[0].values[0].join(' | '));

// Checar queued mais recentes que poderiam ter sido processados
const r3 = db.exec(`
  SELECT job_title, company, status, score_action, updated_at
  FROM job_applications
  WHERE date(updated_at) >= '2026-07-15'
  ORDER BY updated_at DESC
  LIMIT 15
`);
console.log('\n=== REGISTROS >= 15/07 ===');
if (r3.length) {
  const cols = r3[0].columns;
  for (const row of r3[0].values) {
    const obj = {};
    cols.forEach((c,i)=>{obj[c]=row[i];});
    console.log(JSON.stringify(obj));
  }
}
db.close();
