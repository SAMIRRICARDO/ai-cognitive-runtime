import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function readJson(p) { try { return JSON.parse(fs.readFileSync(p,'utf-8')); } catch { return null; } }

const all = [];
const seen = new Set();

const totvs = readJson(path.join(ROOT,'leads_validados_2026-06-03.json'));
if (Array.isArray(totvs)) for (const r of totvs) {
  const k = r.email || r.full_name;
  if (!seen.has(k)) { seen.add(k); all.push({ name: r.full_name, company: r.company_name, role: r.job_title, email: r.email, linkedin: r.linkedin_url || '', campaign: 'TOTVS' }); }
}

const skip = ['blocklist','sample','companies-seed'];
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir,e.name))
    : (e.name.endsWith('.json') && !skip.some(p=>e.name.includes(p))) ? [path.join(dir,e.name)] : []
  );
}
for (const f of walk(path.join(ROOT,'data/leads'))) {
  const d = readJson(f);
  if (!d?.leads?.length) continue;
  for (const r of d.leads) {
    const k = r.email || r.primaryEmail || ((r.contactName||'') + (r.company||''));
    if (seen.has(k)) continue; seen.add(k);
    all.push({ name: r.contactName||r.name||'', company: r.company||r.company_name||'', role: r.role||r.job_title||'', email: r.email||r.primaryEmail||'', linkedin: r.linkedin||r.linkedin_url||'', campaign: d.campaign||f });
  }
}

const withLi = all.filter(l => l.linkedin && l.linkedin !== 'unknown' && l.linkedin.includes('linkedin'));
const noLi   = all.filter(l => !l.linkedin || l.linkedin === 'unknown' || !l.linkedin.includes('linkedin'));

console.log(`Total: ${all.length} | Com LinkedIn: ${withLi.length} | Sem LinkedIn: ${noLi.length}`);
console.log('\nPrimeiros 15 sem LinkedIn:');
noLi.slice(0,15).forEach(l => console.log(` - ${l.name} | ${l.company} | ${l.role.substring(0,50)}`));
console.log('\nPor campanha (sem LinkedIn):');
const byCamp = {};
for (const l of noLi) { const c = l.campaign; byCamp[c] = (byCamp[c]||0)+1; }
Object.entries(byCamp).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([c,n]) => console.log(` ${n.toString().padStart(3)} | ${c.substring(0,60)}`));
