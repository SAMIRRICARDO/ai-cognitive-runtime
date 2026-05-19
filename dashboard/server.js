#!/usr/bin/env node
import http from "http";
import { readFile, readdir } from "fs/promises";
import { dirname, extname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 4200;
const PUBLIC_ROOT = resolve(__dirname, "..");

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
  const normalized = new URL(url, `http://localhost`).pathname;
  if (normalized === "/") return "/dashboard/index.html";
  return normalized;
}

function isToday(value) {
  const date = new Date(value);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

async function loadOutreachMetrics() {
  const outreachDir = resolve(PUBLIC_ROOT, "logs", "outreach");
  const files = await readdir(outreachDir);
  const sessions = [];
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    try {
      const raw = await readFile(resolve(outreachDir, file), "utf8");
      sessions.push(JSON.parse(raw));
    } catch {
      continue;
    }
  }

  const results = sessions.flatMap((session) => Array.isArray(session.results) ? session.results : []);
  const totalSent = sessions.reduce((sum, session) => sum + (Number(session.sent) || 0), 0);
  const todaySent = sessions.reduce((sum, session) => sum + (isToday(session.sessionStartedAt) ? (Number(session.sent) || 0) : 0), 0);
  const batches = sessions.length;
  const companies = new Set(results.map((item) => item.company ?? item.targetEvent ?? "")).size;
  const recentSends = results
    .filter((item) => item.status)
    .sort((a, b) => new Date(b.sentAt ?? b.date ?? 0).valueOf() - new Date(a.sentAt ?? a.date ?? 0).valueOf())
    .slice(0, 6)
    .map((item) => ({
      date: item.sentAt ?? item.date ?? null,
      company: item.company ?? item.targetEvent ?? "-",
      email: item.recipientEmail ?? item.email ?? item.to ?? "-",
      status: item.status,
    }));

  const trend = results.reduce(
    (counts, item) => {
      const date = new Date(item.sentAt ?? item.date ?? 0);
      if (isNaN(date.valueOf())) return counts;
      const keys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      counts[keys[date.getDay()]] += 1;
      return counts;
    },
    { monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 0, sunday: 0 }
  );

  return {
    generatedAt: new Date().toISOString(),
    emailsSentToday: todaySent,
    emailsSentTotal: totalSent,
    batchesExecuted: batches,
    companiesContacted: companies,
    trend,
    recentSends,
  };
}

async function serveFile(pathname, res) {
  try {
    const filePath = resolve(PUBLIC_ROOT, `.${pathname}`);
    if (!filePath.startsWith(PUBLIC_ROOT)) {
      res.writeHead(403);
      res.end("Acesso negado");
      return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": getContentType(filePath) });
    res.end(data);
  } catch (error) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Arquivo não encontrado");
  }
}

const server = http.createServer(async (req, res) => {
  const pathname = getRequestPath(req.url ?? "");

  if (pathname === "/api/outreach-metrics") {
    try {
      const metrics = await loadOutreachMetrics();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(metrics));
      return;
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Não foi possível carregar métricas de outreach" }));
      return;
    }
  }

  serveFile(pathname, res);
});

server.listen(PORT, () => {
  console.log(`Dashboard local iniciado em http://localhost:${PORT}`);
  console.log("Abra o painel em /dashboard/index.html");
});
