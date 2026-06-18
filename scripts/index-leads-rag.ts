/**
 * Indexes all lead data into the local RAG (memory/leads/index.jsonl)
 * so the Comercial AI agent can retrieve leads via keyword search
 * without requiring Postgres/Redis infrastructure.
 *
 * Run: tsx scripts/index-leads-rag.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saveLocalMemory } from "../memory/local-rag.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface RawLead {
  contactName?: string; full_name?: string; name?: string;
  company?: string; company_name?: string;
  role?: string; job_title?: string;
  email?: string; primaryEmail?: string;
  linkedin?: string; linkedin_url?: string;
  status?: string; email_status?: string;
  outreachPriority?: number; relevanceScore?: number; decisao_maker_score?: number;
  phone?: string;
  city?: string; state?: string; country?: string;
  segment?: string;
  linkedin_source?: string;
}

interface CampaignFile { campaign?: string; leads?: RawLead[]; }

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")) as T; } catch { return null; }
}

function normalizeLead(r: RawLead, campaign: string) {
  return {
    name:     r.contactName ?? r.full_name ?? r.name ?? "",
    company:  r.company ?? r.company_name ?? "",
    role:     r.role ?? r.job_title ?? "",
    email:    r.email ?? r.primaryEmail ?? "",
    linkedin: r.linkedin ?? r.linkedin_url ?? "",
    status:   r.status ?? r.email_status ?? "COLLECTED",
    score:    r.outreachPriority ?? r.relevanceScore ?? r.decisao_maker_score ?? 0,
    phone:    r.phone ?? "",
    location: [r.city, r.state, r.country].filter(Boolean).join(", "),
    segment:  r.segment ?? "",
    campaign,
  };
}

const skip = ["blocklist", "sample", "companies-seed"];
function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name))
      : e.name.endsWith(".json") && !skip.some(p => e.name.includes(p))
        ? [path.join(dir, e.name)] : []
  );
}

// Collect all leads
const all: ReturnType<typeof normalizeLead>[] = [];
const seen = new Set<string>();

const totvs = readJson<RawLead[]>(path.join(ROOT, "leads_validados_2026-06-03.json"));
if (Array.isArray(totvs)) {
  for (const r of totvs) {
    const k = r.email ?? r.full_name ?? "";
    if (k && !seen.has(k)) { seen.add(k); all.push(normalizeLead(r, "TOTVS Decision Makers")); }
  }
}

for (const f of walk(path.join(ROOT, "data/leads"))) {
  const d = readJson<CampaignFile>(f);
  if (!d?.leads?.length) continue;
  const campaign = d.campaign ?? path.basename(f, ".json");
  for (const r of d.leads) {
    const k = r.email ?? r.primaryEmail ?? `${r.contactName ?? r.full_name ?? r.name ?? ""}|${r.company ?? ""}`;
    if (k && !seen.has(k)) { seen.add(k); all.push(normalizeLead(r, campaign)); }
  }
}

console.log(`📦 Indexando ${all.length} leads na RAG local...\n`);

let indexed = 0;
let skipped = 0;

for (const lead of all) {
  // Build searchable document text
  const parts = [
    lead.name && `Nome: ${lead.name}`,
    lead.company && `Empresa: ${lead.company}`,
    lead.role && `Cargo: ${lead.role}`,
    lead.email && `Email: ${lead.email}`,
    lead.status && `Status: ${lead.status}`,
    lead.score && `Score: ${lead.score}`,
    lead.linkedin && `LinkedIn: ${lead.linkedin}`,
    lead.phone && `Telefone: ${lead.phone}`,
    lead.location && `Localização: ${lead.location}`,
    lead.segment && `Segmento: ${lead.segment}`,
    `Campanha: ${lead.campaign}`,
  ].filter(Boolean);

  const content = parts.join(" | ");
  if (!content.trim()) { skipped++; continue; }

  const tags = [
    lead.status.toLowerCase(),
    lead.campaign.toLowerCase().replace(/\s+/g, "-"),
    lead.company.toLowerCase().slice(0, 20),
  ].filter(Boolean);

  saveLocalMemory({
    collection: "leads",
    content,
    tags,
    metadata: {
      name: lead.name,
      company: lead.company,
      role: lead.role,
      email: lead.email,
      linkedin: lead.linkedin,
      status: lead.status,
      score: lead.score,
      campaign: lead.campaign,
    },
  });

  indexed++;
}

console.log(`✅ ${indexed} leads indexados | ${skipped} ignorados`);

// Also index campaign summaries
const byCampaign = new Map<string, typeof all>();
for (const l of all) {
  const list = byCampaign.get(l.campaign) ?? [];
  list.push(l); byCampaign.set(l.campaign, list);
}

console.log(`\n📊 Indexando ${byCampaign.size} resumos de campanha...`);
for (const [campaign, leads] of byCampaign) {
  const hot  = leads.filter(l => l.status === "HOT").length;
  const warm = leads.filter(l => l.status === "WARM").length;
  const withEmail = leads.filter(l => l.email).length;
  const companies = [...new Set(leads.map(l => l.company).filter(Boolean))].slice(0, 10).join(", ");

  saveLocalMemory({
    collection: "campaigns",
    content: `Campanha "${campaign}": ${leads.length} leads | HOT: ${hot} | WARM: ${warm} | Com email: ${withEmail} | Empresas: ${companies}`,
    tags: [campaign.toLowerCase().replace(/\s+/g, "-"), "summary"],
    metadata: { campaign, total: leads.length, hot, warm, withEmail },
  });
}

console.log("✅ Indexação completa!");
console.log(`\n🔍 Teste de busca: "HOT leads Microsoft"`);
const { searchLocalMemory } = await import("../memory/local-rag.js");
const results = searchLocalMemory({ query: "HOT leads Microsoft", collections: ["leads"], limit: 3 });
results.forEach(r => console.log(`  → ${r.content.slice(0, 120)}`));
