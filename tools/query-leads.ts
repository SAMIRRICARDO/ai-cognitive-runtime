import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import type { ToolHandler } from "../agents/_base/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Shared file-reading helpers (mirror of api/routes/leads.ts) ───────────────

function readJson<T = unknown>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T; }
  catch { return null; }
}

interface RawLead {
  contactName?: string; full_name?: string; name?: string;
  company?: string; company_name?: string;
  role?: string; job_title?: string;
  email?: string; primaryEmail?: string; possibleEmail?: string;
  linkedin?: string; linkedin_url?: string;
  status?: string; email_status?: string;
  outreachPriority?: number; relevanceScore?: number; decisao_maker_score?: number;
  area?: string; seniority?: string;
}

interface CampaignFile {
  campaign?: string;
  leads?: RawLead[];
}

interface Lead {
  name: string; company: string; role: string;
  email: string; linkedin: string; status: string;
  campaign: string; score: number; area: string; seniority: string;
}

function normalizeLead(raw: RawLead, campaign: string): Lead {
  return {
    name:     raw.contactName ?? raw.full_name ?? raw.name ?? "—",
    company:  raw.company ?? raw.company_name ?? "—",
    role:     raw.role ?? raw.job_title ?? "—",
    email:    raw.email ?? raw.primaryEmail ?? raw.possibleEmail ?? "",
    linkedin: raw.linkedin ?? raw.linkedin_url ?? "",
    status:   raw.status ?? raw.email_status ?? "COLLECTED",
    score:    raw.outreachPriority ?? raw.relevanceScore ?? raw.decisao_maker_score ?? 0,
    area:     raw.area ?? "",
    seniority:raw.seniority ?? "",
    campaign,
  };
}

function loadAllLeads(): Lead[] {
  const leads: Lead[] = [];
  const seen = new Set<string>();

  const add = (campaign: string, raws: RawLead[]) => {
    for (const r of raws ?? []) {
      const l = normalizeLead(r, campaign);
      const key = l.email || `${l.name}|${l.company}`;
      if (!seen.has(key)) { seen.add(key); leads.push(l); }
    }
  };

  // Root-level TOTVS batch
  const totvs = readJson<RawLead[]>(path.join(ROOT, "leads_validados_2026-06-03.json"));
  if (Array.isArray(totvs)) add("TOTVS Decision Makers", totvs);

  // Campaign files under data/leads/
  const skip = ["blocklist", "sample", "companies-seed", "examples"];
  const walk = (dir: string): string[] => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(dir, e.name))
        : e.name.endsWith(".json") && !skip.some((p) => e.name.includes(p))
        ? [path.join(dir, e.name)]
        : []
    );
  };

  for (const f of walk(path.join(ROOT, "data/leads"))) {
    const d = readJson<CampaignFile>(f);
    if (d?.leads?.length) add(d.campaign ?? path.basename(f, ".json"), d.leads);
  }

  return leads;
}

// ── Tool: query_leads ─────────────────────────────────────────────────────────

export const queryLeadsTool: ToolHandler = {
  name: "query_leads",
  schema: {
    name: "query_leads",
    description:
      "Busca leads reais armazenados no VRAXIA. Pode filtrar por status (HOT/WARM/LOW_PRIORITY), campaign, company ou listar todos. Retorna nome, empresa, cargo, email, LinkedIn, score e campanha de cada contato.",
    input_schema: {
      type: "object" as const,
      properties: {
        status:   { type: "string", description: "Filtrar por status: HOT, WARM, LOW_PRIORITY, INVALID, COLLECTED" },
        campaign: { type: "string", description: "Filtrar por nome de campanha (substring match)" },
        company:  { type: "string", description: "Filtrar por empresa (substring match)" },
        limit:    { type: "number", description: "Máximo de leads a retornar (default 50, max 200)" },
        summary:  { type: "boolean", description: "Se true, retorna apenas totais por campanha/status (sem lista detalhada)" },
      },
      required: [],
    },
  },
  execute: async (input) => {
    const { status, campaign, company, limit = 50, summary = false } =
      input as { status?: string; campaign?: string; company?: string; limit?: number; summary?: boolean };

    let leads = loadAllLeads();

    if (status)   leads = leads.filter((l) => l.status.toUpperCase() === status.toUpperCase());
    if (campaign) leads = leads.filter((l) => l.campaign.toLowerCase().includes(campaign.toLowerCase()));
    if (company)  leads = leads.filter((l) => l.company.toLowerCase().includes(company.toLowerCase()));

    if (summary) {
      const byCampaign: Record<string, number> = {};
      const byStatus:   Record<string, number> = {};
      for (const l of leads) {
        byCampaign[l.campaign] = (byCampaign[l.campaign] ?? 0) + 1;
        byStatus[l.status]     = (byStatus[l.status] ?? 0) + 1;
      }
      return { total: leads.length, byCampaign, byStatus };
    }

    const capped = leads.slice(0, Math.min(Number(limit), 200));
    return {
      total: leads.length,
      shown: capped.length,
      leads: capped.map((l) => ({
        name:     l.name,
        company:  l.company,
        role:     l.role,
        email:    l.email || "—",
        linkedin: l.linkedin || "—",
        status:   l.status,
        score:    l.score,
        campaign: l.campaign,
      })),
    };
  },
};
