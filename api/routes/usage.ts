import { Router } from "express";
import { getCostForAgent } from "../../config/costs.js";
import { AVAILABLE_MODULES } from "../../modules/index.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";

export const usageRouter = Router();

// GET /api/usage — cost breakdown per module for this tenant
usageRouter.get("/", async (req, res) => {
  const tenant = (req as AuthenticatedRequest).tenant;
  const prefix = tenant?.id ? `${tenant.id}:` : "";

  const results = await Promise.all(
    AVAILABLE_MODULES.map(async (moduleId) => {
      const record = await getCostForAgent(`${prefix}${moduleId}`);
      return {
        moduleId,
        totalCostUsd: record?.totalCostUsd ?? 0,
        totalInputTokens: record?.totalInputTokens ?? 0,
        totalOutputTokens: record?.totalOutputTokens ?? 0,
        totalSavingsUsd: record?.totalSavingsUsd ?? 0,
        runs: record?.runs ?? 0,
        lastRunAt: record?.lastRunAt ?? null,
        model: record?.model ?? null,
      };
    })
  );

  const totalCost = results.reduce((s, r) => s + r.totalCostUsd, 0);
  const totalRuns = results.reduce((s, r) => s + r.runs, 0);

  res.json({
    tenantId: tenant?.id ?? "dev",
    totalCostUsd: totalCost,
    totalRuns,
    byModule: results.filter((r) => r.runs > 0),
  });
});
