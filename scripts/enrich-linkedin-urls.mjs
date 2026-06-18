/**
 * Enriches leads missing LinkedIn URLs with heuristic profile URLs.
 * Strategy:
 *   1. Slug first+last name → linkedin.com/in/first-last  (direct profile guess)
 *   2. Fallback search URL  → linkedin.com/search/...     (always works)
 * Updates all lead JSON files in place.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ── Name → LinkedIn slug ──────────────────────────────────────────────────────

function removeDiacritics(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function nameToSlug(fullName) {
  const clean = removeDiacritics(fullName.trim().toLowerCase());
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  // Use first + last only (skip middle names)
  const first = parts[0];
  const last  = parts[parts.length - 1];
  return first === last ? first : `${first}-${last}`;
}

function buildLinkedInUrl(name, company) {
  const slug = nameToSlug(name);
  if (!slug) return buildSearchUrl(name, company);
  return `https://www.linkedin.com/in/${slug}`;
}

function buildSearchUrl(name, company) {
  const q = encodeURIComponent(`${name} ${company}`);
  return `https://www.linkedin.com/search/results/people/?keywords=${q}`;
}

function needsLinkedIn(url) {
  return !url || url === 'unknown' || !url.includes('linkedin');
}

// ── File processors ───────────────────────────────────────────────────────────

let totalEnriched = 0;
let totalFiles    = 0;

function enrichCampaignFile(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf-8'); } catch { return; }
  let data;
  try { data = JSON.parse(raw); } catch { return; }

  if (!data?.leads?.length) return;

  let changed = 0;
  for (const lead of data.leads) {
    const li = lead.linkedin || lead.linkedin_url || '';
    if (!needsLinkedIn(li)) continue;

    const name    = lead.contactName || lead.full_name || lead.name || '';
    const company = lead.company || lead.company_name || '';
    if (!name && !company) continue;

    // No contact name → use company LinkedIn page
    const isCompanyPage = !name;
    const url = name
      ? buildLinkedInUrl(name, company)
      : `https://www.linkedin.com/company/${removeDiacritics(company.toLowerCase()).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    if (lead.linkedin     !== undefined) lead.linkedin     = url;
    if (lead.linkedin_url !== undefined) lead.linkedin_url = url;
    // If neither field exists, add linkedin_url
    if (lead.linkedin === undefined && lead.linkedin_url === undefined) lead.linkedin_url = url;
    lead.linkedin_source = isCompanyPage ? 'company_page' : 'heuristic';
    changed++;
  }

  if (changed > 0) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    totalEnriched += changed;
    totalFiles++;
    console.log(`  ✓ ${path.basename(filePath)} — +${changed} LinkedIn URLs`);
  }
}

function enrichArrayFile(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf-8'); } catch { return; }
  let data;
  try { data = JSON.parse(raw); } catch { return; }
  // Handle both direct arrays and {leads:[...]} objects
  const isWrapped = !Array.isArray(data) && Array.isArray(data?.leads);
  if (isWrapped) { enrichCampaignFile(filePath); return; }
  if (!Array.isArray(data)) return;

  let changed = 0;
  for (const lead of data) {
    const li = lead.linkedin_url || lead.linkedin || '';
    if (!needsLinkedIn(li)) continue;

    const name    = lead.full_name || lead.contactName || lead.name || '';
    const company = lead.company_name || lead.company || '';
    if (!name) continue;

    const url = buildLinkedInUrl(name, company);
    if ('linkedin_url' in lead) lead.linkedin_url = url;
    else if ('linkedin' in lead) lead.linkedin = url;
    else lead.linkedin_url = url;
    lead.linkedin_source = 'heuristic';
    changed++;
  }

  if (changed > 0) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    totalEnriched += changed;
    totalFiles++;
    console.log(`  ✓ ${path.basename(filePath)} — +${changed} LinkedIn URLs`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const skip = ['blocklist', 'sample', 'companies-seed'];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name))
      : (e.name.endsWith('.json') && !skip.some(p => e.name.includes(p)))
        ? [path.join(dir, e.name)] : []
  );
}

console.log('🔍 Enriquecendo LinkedIn URLs...\n');

// Campaign files
for (const f of walk(path.join(ROOT, 'data/leads'))) {
  enrichCampaignFile(f);
}

// Root-level array file (TOTVS)
enrichArrayFile(path.join(ROOT, 'leads_validados_2026-06-03.json'));

console.log(`\n✅ Concluído: ${totalEnriched} leads enriquecidos em ${totalFiles} arquivos.`);

// Show a few examples
console.log('\n📋 Exemplos de URLs geradas:');
const sample = JSON.parse(fs.readFileSync(path.join(ROOT,'data/leads/validated/aws-leads-validated.json'),'utf-8'));
if (sample?.leads) {
  sample.leads.slice(0,5).forEach(l =>
    console.log(`  ${(l.contactName||l.name||'').padEnd(30)} → ${l.linkedin||l.linkedin_url||'—'}`)
  );
}
