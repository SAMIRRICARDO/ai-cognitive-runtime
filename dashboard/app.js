import { renderCostChart, renderDeliveryChart, renderEmailTrend, numberFormatter } from "./charts.js";

const defaultMetricsUrl = "./metrics.json";
const outreachMetricsUrl = "/api/outreach-metrics";

function formatPercent(value) {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(value ?? 0);
}

function resolvePaths(filename) {
  return [`/logs/${filename}`, `../logs/${filename}`, `./logs/${filename}`];
}

async function fetchAny(paths) {
  for (const path of paths) {
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (response.ok) {
        return response.json();
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchLog(name) {
  return fetchAny(resolvePaths(name));
}

function getToday(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  return date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}

function buildMetricCards(metrics) {
  document.getElementById("kpi-sent-today").textContent = numberFormatter.format(metrics.emailsSentToday ?? 0);
  document.getElementById("kpi-batches").textContent = numberFormatter.format(metrics.batchesExecuted ?? 0);
  document.getElementById("kpi-reply-rate").textContent = formatPercent(metrics.replyRate ?? 0);
  document.getElementById("kpi-bounce-rate").textContent = formatPercent(metrics.bounceRate ?? 0);
  document.getElementById("kpi-leads").textContent = numberFormatter.format(metrics.leadsCaptured ?? 0);
  document.getElementById("kpi-high-confidence").textContent = numberFormatter.format(metrics.highConfidenceLeads ?? 0);
  document.getElementById("kpi-companies").textContent = numberFormatter.format(metrics.companiesContacted ?? 0);
  document.getElementById("kpi-ai-cost").textContent = formatCurrency((metrics.aiCosts?.claude ?? 0) + (metrics.aiCosts?.openai ?? 0));
}

function renderTables(metrics, outboundEvents) {
  const recentSends = metrics.recentSends ?? [];
  const recentLeads = metrics.recentLeads ?? [];
  const sendsBody = document.getElementById("table-recent-sends");
  const leadsBody = document.getElementById("table-recent-leads");

  sendsBody.innerHTML = "";
  for (const send of recentSends.slice(0, 6)) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="px-3 py-3 text-slate-200">${new Date(send.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
      <td class="px-3 py-3 text-slate-200">${send.company ?? "-"}</td>
      <td class="px-3 py-3 text-slate-200">${send.email ?? send.to ?? "-"}</td>
      <td class="px-3 py-3 text-slate-200">${send.status ?? "-"}</td>
    `;
    sendsBody.append(row);
  }

  leadsBody.innerHTML = "";
  for (const lead of recentLeads.slice(0, 6)) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="px-3 py-3 text-slate-200">${lead.name ?? lead.contactName ?? "-"}</td>
      <td class="px-3 py-3 text-slate-200">${lead.role ?? "-"}</td>
      <td class="px-3 py-3 text-slate-200">${lead.company ?? "-"}</td>
      <td class="px-3 py-3 text-slate-200">${lead.score ?? lead.eventFitScore ?? "-"}</td>
    `;
    leadsBody.append(row);
  }
}

function updateStatus(loaded, metrics) {
  const status = document.getElementById("status-pill");
  const updatedAt = document.getElementById("updated-at");
  status.textContent = loaded ? "Operacional" : "Sem dados";
  status.className = loaded
    ? "inline-flex rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-semibold text-emerald-300"
    : "inline-flex rounded-full bg-amber-500/15 px-3 py-1 text-sm font-semibold text-amber-300";
  updatedAt.textContent = metrics?.generatedAt ? `Atualizado em ${new Date(metrics.generatedAt).toLocaleString("pt-BR")}` : "";
}

function mergeMetrics(base, extra) {
  if (!extra) return base;
  return {
    ...base,
    ...extra,
    aiCosts: { ...(base.aiCosts ?? {}), ...(extra.aiCosts ?? {}) },
    trend: { ...(base.trend ?? {}), ...(extra.trend ?? {}) },
    recentSends: extra.recentSends?.length ? extra.recentSends : base.recentSends,
    recentLeads: extra.recentLeads?.length ? extra.recentLeads : base.recentLeads,
  };
}

function buildTrendFromEvents(outbound) {
  if (!Array.isArray(outbound)) return {};
  const counts = { monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 0, sunday: 0 };
  outbound.forEach((event) => {
    const date = new Date(event.date ?? event.sentAt ?? event.timestamp);
    if (isNaN(date.valueOf())) return;
    const day = date.getDay();
    const keys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    counts[keys[day]] += 1;
  });
  return counts;
}

async function fetchOutreachMetrics() {
  try {
    const response = await fetch(outreachMetricsUrl, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function loadDashboard() {
  const outreachMetrics = await fetchOutreachMetrics();
  const baseMetrics = await fetch(defaultMetricsUrl, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
  const outboundLog = await fetchLog("outbound-log.json");
  const repliesLog = await fetchLog("replies.json");
  const opensLog = await fetchLog("opens.json");
  const rawMetrics = await fetchLog("metrics.json");
  const resendLog = await fetchLog("resend-log.json");

  const defaults = {
    emailsSentToday: 0,
    emailsSentTotal: 0,
    batchesExecuted: 0,
    replyRate: 0,
    bounceRate: 0,
    deliverySuccess: 0,
    leadsCaptured: 0,
    highConfidenceLeads: 0,
    companiesContacted: 0,
    aiCosts: { claude: 0, openai: 0 },
    tokensUsed: 0,
    cheapModeSavings: 0,
    trend: { monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 0, sunday: 0 },
    recentSends: [],
    recentLeads: [],
  };

  let metrics = mergeMetrics(defaults, baseMetrics ?? {});
  if (outreachMetrics) {
    metrics = mergeMetrics(metrics, outreachMetrics);
  }
  if (rawMetrics) {
    metrics = mergeMetrics(metrics, rawMetrics);
  }

  if (Array.isArray(outboundLog) && !outreachMetrics) {
    const sentToday = outboundLog.filter((item) => getToday(item.sentAt ?? item.date ?? item.timestamp)).length;
    const total = outboundLog.length;
    const companies = new Set(outboundLog.map((item) => item.company ?? item.companyName ?? item.contactCompany)).size;
    metrics = {
      ...metrics,
      emailsSentToday: sentToday,
      emailsSentTotal: total,
      companiesContacted: companies,
      batchesExecuted: metrics.batchesExecuted || Math.max(1, Math.ceil(total / 5)),
      trend: buildTrendFromEvents(outboundLog),
      recentSends: outboundLog.slice(-6).reverse().map((item) => ({
        date: item.sentAt ?? item.date ?? item.timestamp,
        company: item.company ?? item.companyName ?? "-",
        email: item.to ?? item.email ?? "-",
        status: item.status ?? "-",
      })),
    };
  }

  if (Array.isArray(repliesLog) && metrics.emailsSentTotal > 0) {
    metrics.replyRate = repliesLog.length / Math.max(1, metrics.emailsSentTotal);
  }

  if (Array.isArray(opensLog) && metrics.emailsSentTotal > 0) {
    metrics.deliverySuccess = Math.min(1, (opensLog.length / Math.max(1, metrics.emailsSentTotal)) + 0.15);
  }

  if (Array.isArray(resendLog)) {
    metrics.bounceRate = Math.min(1, metrics.bounceRate || Math.max(0.02, resendLog.filter((item) => item.status === "bounced").length / Math.max(1, resendLog.length)));
  }

  buildMetricCards(metrics);
  updateStatus(true, metrics);
  renderTables(metrics);

  const emailTrendCanvas = document.getElementById("chart-email-trend");
  const deliveryCanvas = document.getElementById("chart-delivery");
  const costCanvas = document.getElementById("chart-cost");

  if (emailTrendCanvas) renderEmailTrend(emailTrendCanvas, metrics);
  if (deliveryCanvas) renderDeliveryChart(deliveryCanvas, metrics);
  if (costCanvas) renderCostChart(costCanvas, metrics);
}

window.addEventListener("DOMContentLoaded", () => {
  loadDashboard().catch((error) => {
    console.error("Falha ao carregar o dashboard:", error);
    updateStatus(false, null);
  });
});
