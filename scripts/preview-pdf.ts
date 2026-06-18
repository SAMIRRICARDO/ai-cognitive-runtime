// One-shot script: screenshots the PDF HTML template and saves as PNG
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")) as T; } catch { return null; }
}

interface RawLead {
  contactName?: string; full_name?: string; name?: string;
  company?: string; company_name?: string;
  role?: string; job_title?: string;
  email?: string; primaryEmail?: string;
  status?: string; email_status?: string;
  outreachPriority?: number; relevanceScore?: number; decisao_maker_score?: number;
}
interface CampaignFile { campaign?: string; leads?: RawLead[]; }

function norm(r: RawLead, c: string) {
  return {
    name: r.contactName ?? r.full_name ?? r.name ?? "—",
    company: r.company ?? r.company_name ?? "—",
    role: r.role ?? r.job_title ?? "—",
    email: r.email ?? r.primaryEmail ?? "",
    status: r.status ?? r.email_status ?? "COLLECTED",
    score: r.outreachPriority ?? r.relevanceScore ?? r.decisao_maker_score ?? 0,
    campaign: c,
  };
}

// Load all leads
const all: ReturnType<typeof norm>[] = [];
const seen = new Set<string>();
const add = (campaign: string, raws: RawLead[]) => {
  for (const r of raws ?? []) {
    const l = norm(r, campaign);
    const k = l.email || `${l.name}|${l.company}`;
    if (!seen.has(k)) { seen.add(k); all.push(l); }
  }
};
const totvs = readJson<RawLead[]>(path.join(ROOT, "leads_validados_2026-06-03.json"));
if (Array.isArray(totvs)) add("TOTVS Decision Makers", totvs);
const skip = ["blocklist", "sample", "companies-seed"];
const walk = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name))
      : e.name.endsWith(".json") && !skip.some(p => e.name.includes(p)) ? [path.join(dir, e.name)] : []
  );
};
for (const f of walk(path.join(ROOT, "data/leads"))) {
  const d = readJson<CampaignFile>(f);
  if (d?.leads?.length) add(d.campaign ?? path.basename(f, ".json"), d.leads);
}

// Group by campaign
const byCampaign = new Map<string, typeof all>();
for (const l of all) {
  const list = byCampaign.get(l.campaign) ?? [];
  list.push(l); byCampaign.set(l.campaign, list);
}

const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const badge = (s: string) => {
  const m: Record<string, string> = {
    HOT: "background:#ef444422;color:#f87171;border:1px solid #f8717140",
    WARM: "background:#f59e0b22;color:#fbbf24;border:1px solid #fbbf2440",
  };
  return m[s.toUpperCase()] ?? "background:#1e293b;color:#94a3b8;border:1px solid #33415540";
};

const rows = (list: typeof all) => list.slice(0, 12).map((l, i) => `
  <tr style="background:${i%2===0?"#0f172a":"#111827"}">
    <td>${esc(l.name)}</td><td>${esc(l.company)}</td>
    <td style="color:#94a3b8;font-size:10px">${esc(l.role.substring(0,40))}</td>
    <td style="font-family:monospace;font-size:10px;color:#60a5fa">${esc(l.email||"—")}</td>
    <td style="text-align:center"><span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;${badge(l.status)}">${esc(l.status)}</span></td>
    <td style="text-align:center;font-weight:700;color:${l.score>=75?"#4ade80":l.score>=50?"#fbbf24":"#94a3b8"}">${l.score||"—"}</td>
  </tr>`).join("");

const sections = Array.from(byCampaign.entries()).slice(0, 4).map(([name, list]) => `
  <div style="margin-bottom:28px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #1e293b">
      <span style="font-size:12px;font-weight:700;color:#60a5fa">${esc(name)}</span>
      <span style="font-size:10px;color:#475569;background:#1e293b;padding:2px 10px;border-radius:10px">${list.length} leads${list.length>12?" (mostrando 12)":""}</span>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#0a0e18">
        <th style="padding:7px 8px;text-align:left;font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e293b">Nome</th>
        <th style="padding:7px 8px;text-align:left;font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e293b">Empresa</th>
        <th style="padding:7px 8px;text-align:left;font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e293b">Cargo</th>
        <th style="padding:7px 8px;text-align:left;font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e293b">Email</th>
        <th style="padding:7px 8px;text-align:center;font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e293b">Status</th>
        <th style="padding:7px 8px;text-align:center;font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e293b">Score</th>
      </tr></thead>
      <tbody>${rows(list)}</tbody>
    </table>
  </div>`).join("");

const now = new Date().toLocaleDateString("pt-BR", { day:"2-digit", month:"long", year:"numeric" });
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;background:#020817;color:#e2e8f0;font-size:12px;padding:0}</style>
</head><body>
<div style="padding:40px 40px 24px;border-bottom:1px solid #1e293b">
  <div style="font-size:22px;font-weight:800;letter-spacing:-0.5px;background:linear-gradient(135deg,#60a5fa,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent">VRAXIA</div>
  <div style="color:#64748b;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:16px">Enterprise AI OS — Comercial</div>
  <div style="font-size:18px;font-weight:700;color:#f1f5f9;margin-bottom:4px">Relatório de Leads</div>
  <div style="color:#475569;font-size:11px;margin-bottom:20px">Gerado em ${now}</div>
  <div style="display:flex;gap:12px">
    ${[["Total",all.length],["HOT",all.filter(l=>l.status==="HOT").length],["WARM",all.filter(l=>l.status==="WARM").length],["Com Email",all.filter(l=>l.email).length],["Campanhas",byCampaign.size]]
      .map(([k,v])=>`<div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:10px 18px"><div style="font-size:20px;font-weight:800;color:#f1f5f9">${v}</div><div style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-top:2px">${k}</div></div>`).join("")}
  </div>
</div>
<div style="padding:28px 40px">${sections}
  <div style="margin-top:8px;padding:12px 16px;background:#0f172a;border:1px solid #1e293b;border-radius:8px;font-size:10px;color:#475569;text-align:center">
    PDF completo contém todos os ${all.length} leads em ${byCampaign.size} campanhas — preview mostra as 4 primeiras campanhas (12 leads cada)
  </div>
</div>
</body></html>`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 1100, height: 1400 });
await page.setContent(html, { waitUntil: "networkidle" });

const outPath = `${process.env.USERPROFILE ?? "C:/Users/Administrador"}/Desktop/vraxia-leads-preview.png`;
await page.screenshot({ path: outPath, fullPage: true });
await browser.close();
console.log("DONE:" + outPath);
