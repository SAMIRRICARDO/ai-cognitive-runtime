/**
 * validate_leads — Validação e scoring da base de leads existente.
 * Retorna relatório de qualidade: distribuição HOT/WARM/LOW/INVALID,
 * cobertura de email, duplicatas e top leads prontos para prospectar.
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { ToolHandler } from "../agents/_base/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface RawLead {
  contactName?: string; full_name?: string; name?: string;
  company?: string; company_name?: string;
  role?: string; job_title?: string;
  email?: string; primaryEmail?: string; possibleEmail?: string;
  linkedin?: string; linkedin_url?: string;
  status?: string; email_status?: string;
  outreachPriority?: number; relevanceScore?: number; decisao_maker_score?: number;
  area?: string; seniority?: string;
  campaign?: string;
}

interface NormalizedLead {
  name: string; company: string; role: string;
  email: string; linkedin: string; status: string;
  score: number; area: string; campaign: string;
}

function normalize(r: RawLead, campaign: string): NormalizedLead {
  return {
    name:     r.contactName ?? r.full_name ?? r.name ?? "—",
    company:  r.company ?? r.company_name ?? "—",
    role:     r.role ?? r.job_title ?? "—",
    email:    r.email ?? r.primaryEmail ?? r.possibleEmail ?? "",
    linkedin: r.linkedin ?? r.linkedin_url ?? "",
    status:   (r.status ?? r.email_status ?? "COLLECTED").toUpperCase(),
    score:    r.outreachPriority ?? r.relevanceScore ?? r.decisao_maker_score ?? 0,
    area:     r.area ?? "—",
    campaign,
  };
}

function loadAll(): NormalizedLead[] {
  const leads: NormalizedLead[] = [];
  const seen = new Set<string>();

  const add = (campaign: string, raws: RawLead[]) => {
    for (const r of raws ?? []) {
      const l = normalize(r, campaign);
      const key = l.email || `${l.name}|${l.company}`;
      if (!seen.has(key)) { seen.add(key); leads.push(l); }
    }
  };

  // Root TOTVS file
  const totvs = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, "leads_validados_2026-06-03.json"), "utf-8")); } catch { return null; }
  })();
  if (Array.isArray(totvs)) add("TOTVS Decision Makers", totvs);

  // Campaign files
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
    try {
      const d = JSON.parse(fs.readFileSync(f, "utf-8"));
      const raws: RawLead[] = d?.leads ?? (Array.isArray(d) ? d : []);
      if (raws.length) add(d?.campaign ?? path.basename(f, ".json"), raws);
    } catch {}
  }

  return leads;
}

export const validateLeadsTool: ToolHandler = {
  name: "validate_leads",
  schema: {
    name: "validate_leads",
    description:
      "Valida e analisa a qualidade da base de leads existente. " +
      "Retorna distribuição HOT/WARM/LOW_PRIORITY/INVALID, cobertura de email, leads sem contato e top 10 prontos para prospectar. " +
      "Use quando o usuário pedir: validar leads, relatório da base, quais leads estão prontos, análise de qualidade, leads com email. " +
      "Pode filtrar por campanha, status ou score mínimo.",
    input_schema: {
      type: "object" as const,
      properties: {
        campaign: {
          type: "string",
          description: "Filtrar por nome de campanha (substring match, opcional). Ex: 'TOTVS', 'Futurecom'",
        },
        status: {
          type: "string",
          description: "Filtrar por status (opcional): HOT, WARM, LOW_PRIORITY, INVALID, COLLECTED",
        },
        min_score: {
          type: "number",
          description: "Score mínimo para incluir nos resultados (0-100, padrão 0)",
        },
        top_n: {
          type: "number",
          description: "Quantos top leads detalhar (padrão 10, máx 30)",
        },
        show_missing_email: {
          type: "boolean",
          description: "Se true, lista leads sem email (padrão false)",
        },
      },
      required: [],
    },
  },
  execute: async (raw) => {
    const input = raw as {
      campaign?: string;
      status?: string;
      min_score?: number;
      top_n?: number;
      show_missing_email?: boolean;
    };

    let leads = loadAll();

    // Filters
    if (input.campaign) {
      leads = leads.filter((l) => l.campaign.toLowerCase().includes(input.campaign!.toLowerCase()));
    }
    if (input.status) {
      leads = leads.filter((l) => l.status === input.status!.toUpperCase());
    }
    if (input.min_score && input.min_score > 0) {
      leads = leads.filter((l) => l.score >= input.min_score!);
    }

    // Stats
    const byStatus: Record<string, number> = {};
    const byCampaign: Record<string, number> = {};
    let withEmail = 0, withLinkedIn = 0, missingEmail = 0;

    for (const l of leads) {
      byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
      byCampaign[l.campaign] = (byCampaign[l.campaign] ?? 0) + 1;
      if (l.email)    withEmail++;    else missingEmail++;
      if (l.linkedin) withLinkedIn++;
    }

    const emailCoverage = leads.length > 0 ? Math.round((withEmail / leads.length) * 100) : 0;

    // Top leads (HOT first, then by score)
    const topN = Math.min(input.top_n ?? 10, 30);
    const sorted = [...leads].sort((a, b) => {
      const statusOrder: Record<string, number> = { HOT: 4, WARM: 3, COLLECTED: 2, LOW_PRIORITY: 1, INVALID: 0 };
      const so = (statusOrder[b.status] ?? 0) - (statusOrder[a.status] ?? 0);
      return so !== 0 ? so : b.score - a.score;
    });

    const topLeads = sorted
      .filter((l) => l.status !== "INVALID" && l.email)
      .slice(0, topN)
      .map((l) => ({
        name:     l.name,
        company:  l.company,
        role:     l.role,
        email:    l.email,
        linkedin: l.linkedin || null,
        status:   l.status,
        score:    l.score,
        campaign: l.campaign,
      }));

    // Missing email list if requested
    const missingList = input.show_missing_email
      ? leads.filter((l) => !l.email).slice(0, 20).map((l) => ({
          name: l.name, company: l.company, role: l.role, campaign: l.campaign,
        }))
      : undefined;

    // Quality score (0-100)
    const qualityScore = Math.round(
      emailCoverage * 0.5 +
      ((byStatus["HOT"] ?? 0) / Math.max(leads.length, 1)) * 100 * 0.3 +
      (withLinkedIn / Math.max(leads.length, 1)) * 100 * 0.2
    );

    return {
      total: leads.length,
      byStatus,
      byCampaign,
      emailCoverage: `${emailCoverage}% (${withEmail} com email, ${missingEmail} sem)`,
      linkedinCoverage: `${Math.round((withLinkedIn / Math.max(leads.length, 1)) * 100)}%`,
      qualityScore: `${qualityScore}/100`,
      readyToProspect: (byStatus["HOT"] ?? 0) + (byStatus["WARM"] ?? 0),
      topLeads,
      ...(missingList !== undefined ? { missingEmail: missingList } : {}),
    };
  },
};
