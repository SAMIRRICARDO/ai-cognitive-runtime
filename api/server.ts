import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { tenantAuthMiddleware } from "./middleware/auth.js";
import { modulesRouter } from "./routes/modules.js";
import { runRouter } from "./routes/run.js";
import { usageRouter } from "./routes/usage.js";
import { adminRouter } from "./routes/admin.js";
import { leadsRouter } from "./routes/leads.js";
import { senseRouter } from "./routes/sense.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const DEV = env.DEV_MODE === "true";

// ── Middleware ────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Api-Key, X-Admin-Key");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Logging ───────────────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// ── Health (no auth) ─────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    version: "1.0.0",
    devMode: DEV,
    ts: new Date().toISOString(),
  });
});

// ── Dev-mode passthrough OR tenant auth ──────────────────────────────────────
//
// In DEV_MODE, skip tenant auth: inject a synthetic tenant + use global env vars.
// This lets you test the API without Redis/Postgres running.
//
function devPassthrough(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  if (DEV) {
    (req as any).tenant = {
      id: "dev",
      name: "Dev Tenant",
      plan: "enterprise",
      modules: ["comercial", "financeiro", "juridico", "marketing", "operacoes", "conteudo", "lideranca", "produto", "codigo"],
      active: true,
      createdAt: new Date().toISOString(),
      apiKey: "dev",
    };
    (req as any).tenantEnv = {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      TAVILY_API_KEY: env.TAVILY_API_KEY,
      RESEND_API_KEY: env.RESEND_API_KEY,
      RESEND_FROM_EMAIL: env.RESEND_FROM_EMAIL,
      RESEND_FROM_NAME: env.RESEND_FROM_NAME,
      OUTBOUND_BCC_EMAIL: env.OUTBOUND_BCC_EMAIL,
    };
    next();
    return;
  }
  tenantAuthMiddleware(req, res, next);
}

// ── API Routes ────────────────────────────────────────────────────────────────
app.use("/api/modules", devPassthrough, modulesRouter);
app.use("/api/run",     devPassthrough, runRouter);
app.use("/api/usage",   devPassthrough, usageRouter);
app.use("/api/leads",   devPassthrough, leadsRouter);
// Sense: /commercial sem auth (webhook Waalaxy); /stats e /events com devPassthrough
app.use("/api/sense/commercial", senseRouter);
app.use("/api/sense",  devPassthrough, senseRouter);

// ── Billing stats (reads local metrics.json, no auth) ────────────────────────
app.get("/api/billing", async (_req, res) => {
  try {
    const metricsPath = path.resolve(__dirname, "../logs/metrics.json");
    const raw = await readFile(metricsPath, "utf8");
    const m = JSON.parse(raw);
    const costs = m.aiCosts ?? {};
    const claude = costs.claude ?? 0;
    const openai = costs.openai ?? 0;
    res.setHeader("Cache-Control", "no-cache");
    res.json({
      claude,
      openai,
      total: claude + openai,
      tokensUsed: m.tokensUsed ?? 0,
      cheapModeSavings: m.cheapModeSavings ?? 0,
      metricsUpdatedAt: m.generatedAt ?? null,
      fetchedAt: new Date().toISOString(),
    });
  } catch {
    res.json({ claude: 0, openai: 0, total: 0, tokensUsed: 0, cheapModeSavings: 0, fetchedAt: new Date().toISOString() });
  }
});

// ── Admin Routes (always require admin key, no dev passthrough) ───────────────
app.use("/admin", adminRouter);

// ── Dashboard SPA ─────────────────────────────────────────────────────────────
const dashboardDir = path.resolve(__dirname, "../dashboard/vraxia");
app.use("/vraxia", express.static(dashboardDir));
app.get("/vraxia/*splat", (_req, res) => {
  res.sendFile(path.join(dashboardDir, "index.html"));
});

// Default redirect to dashboard
app.get("/", (_req, res) => res.redirect("/vraxia"));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = env.API_PORT ?? 3000;
app.listen(PORT, () => {
  logger.info(`VRAXIA API running on http://localhost:${PORT}`);
  logger.info(`Dashboard: http://localhost:${PORT}/vraxia`);
  logger.info(`Dev mode: ${DEV}`);
});

export { app };
