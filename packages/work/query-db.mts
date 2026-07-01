import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

const SQL = await initSqlJs();
const dbPath = path.resolve('.vraxia-work/work.db');
if (!fs.existsSync(dbPath)) { console.log('DB nao existe'); process.exit(0); }
const buf = fs.readFileSync(dbPath);
const db = new SQL.Database(buf);

// Schema
const schema = db.exec(`PRAGMA table_info(job_applications)`);
if (schema.length) {
  console.log('=== COLUNAS ===');
  for (const row of schema[0].values) {
    console.log(row[1]); // coluna name
  }
}

// 30 mais recentes
const r = db.exec(`SELECT job_title, company, location, status, score_action, score_reason FROM job_applications ORDER BY updated_at DESC LIMIT 30`);
console.log('\n=== CANDIDATURAS ===');
if (r.length) {
  const cols = r[0].columns;
  for (const row of r[0].values) {
    const obj: Record<string, unknown> = {};
    cols.forEach((c: string, i: number) => { obj[c] = row[i]; });
    console.log(JSON.stringify(obj));
  }
} else {
  console.log('(sem registros)');
}

// Contagem
const cnt = db.exec(`SELECT status, score_action, COUNT(*) as n FROM job_applications GROUP BY status, score_action ORDER BY n DESC`);
console.log('\n=== CONTAGEM ===');
if (cnt.length) {
  const cc = cnt[0].columns;
  for (const row of cnt[0].values) {
    const obj: Record<string, unknown> = {};
    cc.forEach((c: string, i: number) => { obj[c] = row[i]; });
    console.log(JSON.stringify(obj));
  }
}

db.close();
