/**
 * Gera PDF de leads com email validado (MX confirmado).
 * Fonte: data/leads/validated/all-leads-email-existence-report-2026-06-18.json
 * Saída: data/leads/validated/leads-validados-2026-06-18.pdf
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Find latest validation report
const VALIDATED_DIR = path.join(ROOT, "data", "leads", "validated");
const reports = fs
  .readdirSync(VALIDATED_DIR)
  .filter((f) => f.startsWith("all-leads-email-existence-report") && f.endsWith(".json"))
  .sort()
  .reverse();

if (reports.length === 0) {
  console.error("Nenhum relatório de validação encontrado em", VALIDATED_DIR);
  process.exit(1);
}

const reportPath = path.join(VALIDATED_DIR, reports[0]!);
console.log(`Lendo: ${reports[0]}`);

const report = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as {
  _meta: {
    generatedAt: string;
    totalUniqueEmails: number;
    counts: Record<string, number>;
    deliverableCandidates: number;
  };
  deliverableCandidates: Array<{
    email: string;
    domain: string;
    mxHosts: string[];
    status: string;
    reason: string;
    blockedByDoNotContact: boolean;
    contexts: Array<{
      company: string;
      name: string;
      role: string;
      campaign: string;
      previousStatus: string;
    }>;
  }>;
  blocked?: Array<{ email: string; reason: string }>;
};

// Deduplicate and pick best context per lead
function pickContext(contexts: typeof report.deliverableCandidates[0]["contexts"]) {
  return (
    contexts.find((c) => c.name && c.company) ??
    contexts.find((c) => c.name || c.company) ??
    (contexts[0] ?? { name: "", company: "", role: "", campaign: "", previousStatus: "" })
  );
}

function mxProvider(hosts: string[]): string {
  const h = (hosts[0] ?? "").toLowerCase();
  if (h.includes("google")) return "Google Workspace";
  if (h.includes("outlook") || h.includes("protection.outlook")) return "Microsoft 365";
  if (h.includes("mimecast")) return "Mimecast";
  if (h.includes("proofpoint")) return "Proofpoint";
  if (h.includes("amazonses")) return "Amazon SES";
  if (h.includes("sendgrid")) return "SendGrid";
  if (h.includes("mailgun")) return "Mailgun";
  const first = hosts[0];
  return first ? first.split(".").slice(-2).join(".") : "—";
}

function mxBadge(hosts: string[]): string {
  const provider = mxProvider(hosts);
  const cls = provider.includes("Google")
    ? "google"
    : provider.includes("Microsoft")
    ? "ms"
    : "other";
  return `<span class="mx ${cls}">${provider}</span>`;
}

const leads = report.deliverableCandidates;
const meta  = report._meta;
const total = leads.length;
const googleCount = leads.filter((l) => mxProvider(l.mxHosts).includes("Google")).length;
const msCount     = leads.filter((l) => mxProvider(l.mxHosts).includes("Microsoft")).length;
const otherCount  = total - googleCount - msCount;
const blocked     = meta.counts.blocked ?? 0;
const invalid     = (meta.counts.invalid_domain ?? 0) + (meta.counts.invalid_syntax ?? 0);
const genDate     = new Date(meta.generatedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "long", year: "numeric" });

const rows = leads.map((l, i) => {
  const ctx = pickContext(l.contexts);
  const name    = ctx.name    || "—";
  const domainFallback = l.domain.split(".")[0] ?? "—";
  const company = ctx.company || domainFallback;
  const role    = ctx.role    || "—";
  return `
  <tr class="${i % 2 === 0 ? "even" : "odd"}">
    <td class="num">${i + 1}</td>
    <td><strong>${name}</strong></td>
    <td class="role">${role}</td>
    <td><strong>${company}</strong></td>
    <td class="email">${l.email}</td>
    <td>${mxBadge(l.mxHosts)}</td>
  </tr>`;
}).join("");

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Helvetica Neue',Arial,sans-serif; font-size:10.5px; color:#1a1a2e; background:#fff; }
  .page { padding:30px 34px; }

  .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #7c3aed; padding-bottom:14px; margin-bottom:22px; }
  .brand h1  { font-size:22px; font-weight:800; color:#7c3aed; letter-spacing:-0.5px; }
  .brand p   { font-size:10px; color:#6b7280; margin-top:3px; }
  .meta      { text-align:right; font-size:9.5px; color:#6b7280; line-height:1.7; }
  .meta strong { color:#1a1a2e; }

  .kpis { display:flex; gap:10px; margin-bottom:22px; }
  .kpi  { flex:1; background:#f8f7ff; border:1px solid #e5e7eb; border-radius:8px; padding:11px 14px; }
  .kpi .num   { font-size:26px; font-weight:800; color:#7c3aed; line-height:1; }
  .kpi .label { font-size:9px; color:#6b7280; margin-top:3px; text-transform:uppercase; letter-spacing:0.5px; }
  .kpi.green .num  { color:#16a34a; }
  .kpi.blue  .num  { color:#2563eb; }
  .kpi.red   .num  { color:#dc2626; }
  .kpi.gray  .num  { color:#6b7280; }

  .section-title { font-size:12px; font-weight:700; color:#7c3aed; margin:0 0 10px; text-transform:uppercase; letter-spacing:0.5px; border-left:3px solid #7c3aed; padding-left:8px; }

  table { width:100%; border-collapse:collapse; }
  th    { background:#7c3aed; color:#fff; font-size:8.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; padding:6px 8px; text-align:left; }
  td    { padding:5.5px 8px; border-bottom:1px solid #f3f4f6; vertical-align:middle; }
  tr.even { background:#fafafa; }
  tr.odd  { background:#ffffff; }
  td.num  { color:#9ca3af; font-size:8.5px; width:22px; }
  td.email { font-family:monospace; font-size:9px; color:#374151; }
  td.role  { font-size:9.5px; color:#4b5563; max-width:160px; }

  .mx { display:inline-block; padding:2px 6px; border-radius:8px; font-size:8px; font-weight:600; }
  .mx.google { background:#dcfce7; color:#16a34a; }
  .mx.ms     { background:#dbeafe; color:#1d4ed8; }
  .mx.other  { background:#f3f4f6; color:#6b7280; }

  .legend { display:flex; gap:16px; margin:14px 0 6px; font-size:9px; color:#6b7280; }
  .legend-item { display:flex; align-items:center; gap:5px; }

  .footer { margin-top:20px; border-top:1px solid #e5e7eb; padding-top:10px; display:flex; justify-content:space-between; font-size:8.5px; color:#9ca3af; }

  .note { background:#fffbeb; border:1px solid #fde68a; border-radius:6px; padding:8px 12px; font-size:9px; color:#92400e; margin-bottom:16px; }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="brand">
      <h1>VRASHOWS</h1>
      <p>Relatório de Leads com Email Validado — Campanha B2B Enterprise</p>
      <p style="margin-top:5px;font-size:9.5px;color:#374151;">
        <strong>Critério de validação:</strong> MX record ativo (SMTP sem envio de dados)<br/>
        <strong>Responsável:</strong> Samir Ricardo Almeida · Fundador VRASHOWS · AI Solutions Architect
      </p>
    </div>
    <div class="meta">
      <div><strong>Validado em:</strong> ${genDate}</div>
      <div><strong>Total único analisado:</strong> ${meta.totalUniqueEmails} emails</div>
      <div><strong>Gerado em:</strong> ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</div>
      <div><strong>Confidencial — uso interno</strong></div>
    </div>
  </div>

  <div class="kpis">
    <div class="kpi green">
      <div class="num">${total}</div>
      <div class="label">Leads Entregáveis (MX ✓)</div>
    </div>
    <div class="kpi blue">
      <div class="num">${googleCount}</div>
      <div class="label">Google Workspace</div>
    </div>
    <div class="kpi blue">
      <div class="num">${msCount}</div>
      <div class="label">Microsoft 365</div>
    </div>
    <div class="kpi gray">
      <div class="num">${otherCount}</div>
      <div class="label">Outros provedores</div>
    </div>
    <div class="kpi red">
      <div class="num">${blocked}</div>
      <div class="label">Bloqueados (DNC)</div>
    </div>
    <div class="kpi red">
      <div class="num">${invalid}</div>
      <div class="label">Domínio inválido</div>
    </div>
  </div>

  <div class="note">
    ⚠️ Validação via MX record — domínio aceita emails. Caixas individuais não foram testadas (SMTP sem DATA). Taxa estimada de deliverability: <strong>85-95%</strong>. Recomenda-se warm-up antes de disparo em massa.
  </div>

  <div class="section-title">${total} leads entregáveis — prontos para outreach</div>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Nome</th>
        <th>Cargo</th>
        <th>Empresa</th>
        <th>Email</th>
        <th>Provedor MX</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="footer">
    <span>VRASHOWS · contato@vrashows.com.br · (11) 95357-7804 · www.vrashows.com.br</span>
    <span>VRAXIA AI OS — Gerado automaticamente · Confidencial</span>
  </div>

</div>
</body>
</html>`;

const dateTag  = reports[0]!.replace("all-leads-email-existence-report-", "").replace(".json", "");
const htmlPath = path.join(VALIDATED_DIR, `leads-validados-${dateTag}.html`);
const pdfPath  = path.join(VALIDATED_DIR, `leads-validados-${dateTag}.pdf`);

fs.writeFileSync(htmlPath, html, "utf-8");
console.log("HTML gerado. Convertendo para PDF...");

const browser = await chromium.launch({ headless: true });
const pg      = await browser.newPage();
await pg.goto(`file:///${htmlPath.replace(/\\/g, "/")}`, { waitUntil: "networkidle" });
await pg.pdf({
  path:            pdfPath,
  format:          "A4",
  landscape:       true,
  printBackground: true,
  margin:          { top: "0", bottom: "0", left: "0", right: "0" },
});
await browser.close();

console.log(`\n✅ PDF gerado: ${pdfPath}`);
console.log(`   ${total} leads entregáveis | Google: ${googleCount} | Microsoft: ${msCount} | Outros: ${otherCount}`);
console.log(`   Bloqueados (DNC): ${blocked} | Domínio inválido: ${invalid}\n`);
