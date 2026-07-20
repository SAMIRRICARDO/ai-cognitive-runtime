import initSqlJs from 'sql.js';
import fs from 'fs';
const SQL = await initSqlJs();
const buf = fs.readFileSync('.vraxia-work/work.db');
const db = new SQL.Database(buf);

// Por dia/status
const byDay = db.exec(`
  SELECT date(updated_at) as dia, status, COUNT(*) n
  FROM job_applications
  WHERE updated_at IS NOT NULL
  GROUP BY dia, status
  ORDER BY dia DESC
  LIMIT 20
`);
console.log('=== POR DIA/STATUS ===');
if (byDay.length) for (const row of byDay[0].values) console.log(row.join(' | '));

// 10 mais recentes
const recent = db.exec(`
  SELECT job_title, company, status, applied_at, updated_at
  FROM job_applications
  ORDER BY updated_at DESC
  LIMIT 10
`);
console.log('\n=== 10 MAIS RECENTES (qualquer status) ===');
if (recent.length) {
  const cols = recent[0].columns;
  for (const row of recent[0].values) {
    const obj = {};
    cols.forEach((c,i) => { obj[c]=row[i]; });
    console.log(JSON.stringify(obj));
  }
}
db.close();
