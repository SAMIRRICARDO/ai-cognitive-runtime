import { Router } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

export const leadsRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function readJson<T = unknown>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

interface LeadRecord {
  name: string;
  company: string;
  role: string;
  email: string;
  linkedin: string;
  status: string;
  campaign: string;
  score: number;
}

interface OutboundEntry {
  date: string;
  company: string;
  email: string;
  contactName?: string;
  status: string;
  sentAt?: string;
  source?: string;
}

interface LinkedInEntry {
  linkedin_url: string;
  name: string;
  company: string;
  state: string;
  transitionAt: string;
  attemptCount: number;
}

interface CampaignFile {
  campaign?: string;
  targetEvent?: string;
  _meta?: Record<string, unknown>;
  leads?: RawLead[];
}

interface RawLead {
  contactName?: string;
  full_name?: string;
  name?: string;
  company?: string;
  company_name?: string;
  role?: string;
  job_title?: string;
  email?: string;
  primaryEmail?: string;
  possibleEmail?: string;
  linkedin?: string;
  linkedin_url?: string;
  status?: string;
  email_status?: string;
  outreachPriority?: number;
  relevanceScore?: number;
  decisao_maker_score?: number;
}

function normalizeLead(raw: RawLead, campaign: string): LeadRecord {
  const name = raw.contactName ?? raw.full_name ?? raw.name ?? "—";
  const company = raw.company ?? raw.company_name ?? "—";
  const role = raw.role ?? raw.job_title ?? "—";
  const email = raw.email ?? raw.primaryEmail ?? raw.possibleEmail ?? "";
  const linkedin = raw.linkedin ?? raw.linkedin_url ?? "";
  const status = raw.status ?? raw.email_status ?? "COLLECTED";
  const score = raw.outreachPriority ?? raw.relevanceScore ?? raw.decisao_maker_score ?? 0;
  return { name, company, role, email, linkedin, status, campaign, score };
}

// ── Data loaders ──────────────────────────────────────────────────────────────

function loadOutboundLog(): OutboundEntry[] {
  return (readJson<OutboundEntry[]>(path.join(ROOT, "logs/outbound-log.json"))) ?? [];
}

function loadLinkedInStates(): LinkedInEntry[] {
  const raw = readJson<LinkedInEntry[]>(path.join(ROOT, "data/linkedin/lead-states.json"));
  if (Array.isArray(raw)) return raw;
  return [];
}

function loadAllLeads(): { leads: LeadRecord[]; campaigns: Map<string, LeadRecord[]> } {
  const campaigns = new Map<string, LeadRecord[]>();

  const addLeads = (campaignName: string, raws: RawLead[]) => {
    if (!raws?.length) return;
    const normalized = raws.map((r) => normalizeLead(r, campaignName));
    const existing = campaigns.get(campaignName) ?? [];
    campaigns.set(campaignName, [...existing, ...normalized]);
  };

  // TOTVS validated batch (root-level array, not wrapped in campaign)
  const totvs = readJson<RawLead[]>(path.join(ROOT, "leads_validados_2026-06-03.json"));
  if (Array.isArray(totvs)) addLeads("TOTVS Decision Makers", totvs);

  // All campaign JSON files under data/leads/**/*.json
  const skipPatterns = ["blocklist", "sample", "companies-seed", "examples"];
  const findJsonFiles = (dir: string): string[] => {
    if (!fs.existsSync(dir)) return [];
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        results.push(...findJsonFiles(path.join(dir, entry.name)));
      } else if (entry.name.endsWith(".json") && !skipPatterns.some((p) => entry.name.includes(p))) {
        results.push(path.join(dir, entry.name));
      }
    }
    return results;
  };

  for (const filePath of findJsonFiles(path.join(ROOT, "data/leads"))) {
    const data = readJson<CampaignFile>(filePath);
    if (!data || !Array.isArray(data.leads) || data.leads.length === 0) continue;
    const campaignName = data.campaign ?? path.basename(filePath, ".json");
    addLeads(campaignName, data.leads);
  }

  // Deduplicate leads by email within each campaign
  const deduplicated = new Map<string, LeadRecord[]>();
  for (const [campaign, leads] of campaigns) {
    const seen = new Set<string>();
    const unique: LeadRecord[] = [];
    for (const lead of leads) {
      const key = lead.email || `${lead.name}|${lead.company}`;
      if (!seen.has(key)) { seen.add(key); unique.push(lead); }
    }
    deduplicated.set(campaign, unique);
  }

  const allLeads: LeadRecord[] = [];
  for (const leads of deduplicated.values()) allLeads.push(...leads);

  return { leads: allLeads, campaigns: deduplicated };
}

// ── Friendly campaign name ────────────────────────────────────────────────────

function friendlyName(raw: string): string {
  const map: Record<string, string> = {
    "futurecom-2026-enterprise-daily-acquisition": "Futurecom 2026 — Enterprise",
    "futurecom-2026-enterprise-expansion-v1": "Futurecom 2026 — Expansion v1",
    "futurecom-2026-enterprise-v1": "Futurecom 2026 — v1",
    "ialeads-exclusive-tech-ai-cloud-saas-2026-05-27": "Tech/AI/Cloud — Exclusive 50",
    "AWS Enterprise LATAM": "AWS Enterprise LATAM",
    "Telecom Elite": "Telecom Elite",
    "TOTVS Decision Makers": "TOTVS Decision Makers",
  };
  return map[raw] ?? raw.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).substring(0, 40);
}

// ── GET /api/leads/stats ──────────────────────────────────────────────────────

leadsRouter.get("/stats", (_req, res) => {
  const outbound = loadOutboundLog();
  const linkedInStates = loadLinkedInStates();
  const { leads, campaigns } = loadAllLeads();

  // Outbound metrics
  const sent = outbound.filter((e) => e.status === "sent").length;
  const bounced = outbound.filter((e) => e.status === "bounced").length;
  const total = sent + bounced;
  const deliveryRate = total > 0 ? +((sent / total) * 100).toFixed(1) : 0;

  // Lead status breakdown
  const hot = leads.filter((l) =>
    ["HOT", "high", "verified"].includes((l.status ?? "").toUpperCase()) || l.score >= 75
  ).length;
  const warm = leads.filter((l) =>
    ["WARM", "medium", "risky"].includes((l.status ?? "").toUpperCase()) || (l.score >= 50 && l.score < 75)
  ).length;

  // LinkedIn states
  const linkedinActive = linkedInStates.filter((s) =>
    ["MESSAGE_SENT", "INVITATION_SENT"].includes(s.state)
  ).length;

  // Daily volume (last 14 days from outbound-log)
  const dailyMap = new Map<string, number>();
  for (const entry of outbound) {
    const dateStr = (entry.sentAt ?? entry.date ?? "").substring(0, 10);
    if (dateStr) dailyMap.set(dateStr, (dailyMap.get(dateStr) ?? 0) + 1);
  }
  const dailyVolume = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([date, count]) => ({ date, count }));

  // Campaign summary
  const campaignSummary = Array.from(campaigns.entries())
    .map(([name, cLeads]) => {
      const emailsInCampaign = outbound.filter((o) =>
        cLeads.some((l) => l.email && l.email === o.email)
      ).length;
      const hotLeads = cLeads.filter((l) => l.score >= 75 || l.status === "HOT").length;
      const campaignStatus = hotLeads > cLeads.length * 0.3 ? "HOT"
        : hotLeads > 0 ? "WARM" : "ACTIVE";
      return {
        name: friendlyName(name),
        leads: cLeads.length,
        sent: emailsInCampaign,
        delivery: emailsInCampaign > 0
          ? +(
              (outbound.filter((o) => o.status === "sent" && cLeads.some((l) => l.email === o.email)).length /
                emailsInCampaign) *
              100
            ).toFixed(1)
          : 0,
        status: campaignStatus,
      };
    })
    .sort((a, b) => b.leads - a.leads);

  res.json({
    totalLeads: leads.length,
    emailsSent: sent,
    emailsBounced: bounced,
    deliveryRate,
    activeCampaigns: campaigns.size,
    linkedinActive,
    linkedinTotal: linkedInStates.length,
    hotLeads: hot,
    warmLeads: warm,
    dailyVolume,
    campaigns: campaignSummary,
  });
});

// ── GET /api/leads ────────────────────────────────────────────────────────────

leadsRouter.get("/", (req, res) => {
  const { leads } = loadAllLeads();
  const page = Math.max(1, parseInt((req.query.page as string) ?? "1"));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? "50")));
  const q = ((req.query.q as string) ?? "").toLowerCase();
  const status = (req.query.status as string) ?? "";

  let filtered = leads;
  if (q) {
    filtered = filtered.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.company.toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q)
    );
  }
  if (status) {
    filtered = filtered.filter((l) => l.status?.toUpperCase() === status.toUpperCase());
  }

  const total = filtered.length;
  const slice = filtered.slice((page - 1) * limit, page * limit);
  res.json({ leads: slice, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── GET /api/leads/outbound ───────────────────────────────────────────────────

leadsRouter.get("/outbound", (req, res) => {
  const outbound = loadOutboundLog();
  const limit = Math.min(200, parseInt((req.query.limit as string) ?? "50"));
  res.json({ records: outbound.slice(-limit).reverse(), total: outbound.length });
});

// ── GET /api/leads/linkedin ───────────────────────────────────────────────────

leadsRouter.get("/linkedin", (_req, res) => {
  const states = loadLinkedInStates();
  res.json({ records: states, total: states.length });
});

// ── GET /api/leads/export ─────────────────────────────────────────────────────
// Downloads all leads as CSV. Query: ?status=HOT&campaign=Futurecom

leadsRouter.get("/export", (req, res) => {
  const { leads } = loadAllLeads();
  const status = (req.query.status as string) ?? "";
  const campaign = (req.query.campaign as string) ?? "";

  let filtered = leads;
  if (status)   filtered = filtered.filter((l) => l.status.toUpperCase() === status.toUpperCase());
  if (campaign) filtered = filtered.filter((l) => l.campaign.toLowerCase().includes(campaign.toLowerCase()));

  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["Nome", "Empresa", "Cargo", "Email", "LinkedIn", "Status", "Score", "Campanha"];
  const rows = filtered.map((l) =>
    [l.name, l.company, l.role, l.email, l.linkedin, l.status, String(l.score), l.campaign].map(esc).join(",")
  );
  const csv = [header.join(","), ...rows].join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="vraxia-leads.csv"`);
  res.send("﻿" + csv); // BOM for Excel UTF-8 recognition
});

// ── GET /api/leads/export/pdf ─────────────────────────────────────────────────
// Generates a PDF report of all leads using headless Chromium (Playwright).
// Query: ?status=HOT&campaign=Futurecom&title=My+Report

leadsRouter.get("/export/pdf", async (req, res) => {
  const { leads } = loadAllLeads();
  const statusFilter   = (req.query.status   as string) ?? "";
  const campaignFilter = (req.query.campaign as string) ?? "";
  const title          = (req.query.title    as string) ?? "VRAXIA — Relatório de Leads";

  let filtered = leads;
  if (statusFilter)   filtered = filtered.filter((l) => l.status.toUpperCase() === statusFilter.toUpperCase());
  if (campaignFilter) filtered = filtered.filter((l) => l.campaign.toLowerCase().includes(campaignFilter.toLowerCase()));

  // Group by campaign for the PDF sections
  const byCampaign = new Map<string, typeof filtered>();
  for (const l of filtered) {
    const list = byCampaign.get(l.campaign) ?? [];
    list.push(l);
    byCampaign.set(l.campaign, list);
  }

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      HOT: "background:#ef444422;color:#f87171;border:1px solid #f8717140",
      WARM: "background:#f59e0b22;color:#fbbf24;border:1px solid #fbbf2440",
      LOW_PRIORITY: "background:#6b728022;color:#9ca3af;border:1px solid #9ca3af40",
      INVALID: "background:#dc262622;color:#f87171;border:1px solid #f8717140",
    };
    return map[s.toUpperCase()] ?? "background:#1e293b;color:#94a3b8;border:1px solid #33415540";
  };

  const tableRows = (list: typeof filtered) =>
    list.map((l, i) => `
      <tr style="background:${i % 2 === 0 ? "#0f172a" : "#111827"}">
        <td>${esc(l.name)}</td>
        <td>${esc(l.company)}</td>
        <td style="color:#94a3b8">${esc(l.role)}</td>
        <td style="font-family:monospace;font-size:11px;color:#60a5fa">${esc(l.email || "—")}</td>
        <td style="text-align:center">
          <span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;${statusBadge(l.status)}">${esc(l.status)}</span>
        </td>
        <td style="text-align:center;font-weight:700;color:${l.score >= 75 ? "#4ade80" : l.score >= 50 ? "#fbbf24" : "#94a3b8"}">${l.score || "—"}</td>
      </tr>`).join("");

  const sections = Array.from(byCampaign.entries()).map(([campaign, list]) => `
    <div class="campaign-section">
      <div class="campaign-header">
        <span class="campaign-name">${esc(campaign)}</span>
        <span class="campaign-count">${list.length} leads</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Nome</th><th>Empresa</th><th>Cargo</th>
            <th>Email</th><th>Status</th><th>Score</th>
          </tr>
        </thead>
        <tbody>${tableRows(list)}</tbody>
      </table>
    </div>`).join("");

  const now = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #020817; color: #e2e8f0; font-size: 12px; }
  .cover { padding: 48px 40px 32px; border-bottom: 1px solid #1e293b; }
  .logo { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; background: linear-gradient(135deg,#60a5fa,#a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 4px; }
  .subtitle { color: #64748b; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 24px; }
  .report-title { font-size: 20px; font-weight: 700; color: #f1f5f9; margin-bottom: 6px; }
  .report-meta { color: #475569; font-size: 11px; }
  .kpi-row { display: flex; gap: 16px; margin-top: 24px; flex-wrap: wrap; }
  .kpi { background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 12px 20px; min-width: 120px; }
  .kpi-val { font-size: 22px; font-weight: 800; color: #f1f5f9; }
  .kpi-lbl { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }
  .content { padding: 32px 40px; }
  .campaign-section { margin-bottom: 40px; page-break-inside: avoid; }
  .campaign-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid #1e293b; }
  .campaign-name { font-size: 13px; font-weight: 700; color: #60a5fa; }
  .campaign-count { font-size: 11px; color: #475569; background: #1e293b; padding: 2px 10px; border-radius: 10px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  th { background: #0a0e18; color: #64748b; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; padding: 8px 10px; text-align: left; border-bottom: 1px solid #1e293b; }
  td { padding: 7px 10px; color: #cbd5e1; border-bottom: 1px solid #0f172a; vertical-align: middle; }
  .footer { position: fixed; bottom: 20px; left: 40px; right: 40px; display: flex; justify-content: space-between; font-size: 10px; color: #334155; border-top: 1px solid #1e293b; padding-top: 8px; }
  @page { size: A4; margin: 0; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="cover">
  <div class="logo">VRAXIA</div>
  <div class="subtitle">Enterprise AI OS — Comercial</div>
  <div class="report-title">${esc(title)}</div>
  <div class="report-meta">Gerado em ${now} · ${filtered.length} leads · ${byCampaign.size} campanhas</div>
  <div class="kpi-row">
    <div class="kpi"><div class="kpi-val">${filtered.length}</div><div class="kpi-lbl">Total de Leads</div></div>
    <div class="kpi"><div class="kpi-val">${filtered.filter(l => l.status === "HOT").length}</div><div class="kpi-lbl">HOT</div></div>
    <div class="kpi"><div class="kpi-val">${filtered.filter(l => l.status === "WARM").length}</div><div class="kpi-lbl">WARM</div></div>
    <div class="kpi"><div class="kpi-val">${filtered.filter(l => l.email && l.email !== "—").length}</div><div class="kpi-lbl">Com Email</div></div>
    <div class="kpi"><div class="kpi-val">${byCampaign.size}</div><div class="kpi-lbl">Campanhas</div></div>
  </div>
</div>
<div class="content">${sections}</div>
<div class="footer">
  <span>VRAXIA OS — Confidencial</span>
  <span>${now}</span>
</div>
</body>
</html>`;

  let browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="vraxia-leads-${Date.now()}.pdf"`);
    res.send(Buffer.from(pdf));
  } catch (err) {
    res.status(500).json({ error: "PDF generation failed", detail: String(err) });
  } finally {
    await browser?.close();
  }
});

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
