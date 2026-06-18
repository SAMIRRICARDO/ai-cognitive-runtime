#!/usr/bin/env node
import http from "http";
import { readFile } from "fs/promises";
import { dirname, extname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 4200;
const PUBLIC_ROOT = resolve(__dirname, "..");
const DASHBOARD_ROOT = resolve(__dirname);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function getContentType(pathname) {
  return MIME_TYPES[extname(pathname).toLowerCase()] || "application/octet-stream";
}

function getRequestPath(url) {
  const pathname = new URL(url, "http://localhost").pathname;
  if (pathname === "/" || pathname === "/dashboard" || pathname === "/dashboard/") {
    return "/vraxia/index.html";
  }
  return pathname;
}

async function safeReadJson(path) {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function resolveDashboardPath(pathname) {
  const filePath = resolve(DASHBOARD_ROOT, `.${pathname}`);
  if (!filePath.startsWith(DASHBOARD_ROOT)) return null;
  return filePath;
}

async function serveFile(pathname, res) {
  try {
    const filePath = resolveDashboardPath(pathname);
    if (!filePath) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Acesso negado");
      return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": getContentType(filePath) });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Arquivo não encontrado");
  }
}

async function loadLiveData() {
  const logsPath = resolve(PUBLIC_ROOT, "logs");
  const outboundLog = (await safeReadJson(resolve(logsPath, "outbound-log.json"))) ?? [];
  const replies = (await safeReadJson(resolve(logsPath, "replies.json"))) ?? [];
  const opens = (await safeReadJson(resolve(logsPath, "opens.json"))) ?? [];
  const resendLog = (await safeReadJson(resolve(logsPath, "resend-log.json"))) ?? [];
  const metrics = (await safeReadJson(resolve(logsPath, "metrics.json"))) ?? {};

  const now = new Date();
  const validOutbound = Array.isArray(outboundLog) ? outboundLog : [];
  const sentToday = validOutbound.filter((item) => {
    const date = new Date(item.sentAt ?? item.date ?? item.timestamp);
    return !Number.isNaN(date.valueOf()) && date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }).length;

  const totalSent = validOutbound.length;
  const companies = new Set(validOutbound.map((item) => item.company ?? item.companyName ?? item.contactCompany ?? "")).size;
  const recentSends = validOutbound
    .map((item) => ({
      date: item.sentAt ?? item.date ?? item.timestamp,
      company: item.company ?? item.companyName ?? item.contactCompany ?? "-",
      destination: item.to ?? item.email ?? item.recipientEmail ?? "-",
      status: item.status ?? item.state ?? "-",
    }))
    .filter((item) => item.date)
    .sort((a, b) => new Date(b.date).valueOf() - new Date(a.date).valueOf())
    .slice(0, 6);

  return {
    generatedAt: new Date().toISOString(),
    emailsSentToday: sentToday,
    emailsSentTotal: totalSent,
    companiesContacted: companies,
    replyRate: totalSent ? Math.min(1, replies.length / totalSent) : 0,
    deliverySuccess: totalSent ? Math.min(1, opens.length / totalSent) : 0,
    bounceRate: totalSent ? Math.min(1, (Array.isArray(resendLog) ? resendLog.filter((item) => String(item.status ?? "").toLowerCase().includes("bounce")).length : 0) / totalSent) : 0,
    aiCost: metrics.aiCosts ? ((metrics.aiCosts.claude ?? 0) + (metrics.aiCosts.openai ?? 0)) : 0,
    recentSends,
  };
}

const server = http.createServer(async (req, res) => {
  const pathname = getRequestPath(req.url ?? "");

  if (pathname === "/api/live-dashboard") {
    const data = await loadLiveData();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
    return;
  }

  if (pathname === "/api/billing") {
    const metrics = (await safeReadJson(resolve(PUBLIC_ROOT, "logs", "metrics.json"))) ?? {};
    const aiCosts = metrics.aiCosts ?? {};
    const claudeCost = aiCosts.claude ?? 0;
    const openaiCost = aiCosts.openai ?? 0;
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(JSON.stringify({
      claude: claudeCost,
      openai: openaiCost,
      total: claudeCost + openaiCost,
      tokensUsed: metrics.tokensUsed ?? 0,
      cheapModeSavings: metrics.cheapModeSavings ?? 0,
      metricsUpdatedAt: metrics.generatedAt ?? null,
      fetchedAt: new Date().toISOString(),
    }));
    return;
  }

  await serveFile(pathname, res);
});

server.listen(PORT, () => {
  console.log(`Dashboard em tempo real iniciado em http://localhost:${PORT}`);
  console.log("Abra /dashboard/index.html");
});
