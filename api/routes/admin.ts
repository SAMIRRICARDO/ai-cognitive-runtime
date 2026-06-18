import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { provisionTenant } from "../../tenant/provisioner.js";
import { getTenantManager } from "../../tenant/manager.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

export const adminRouter = Router();

// Admin auth — separate from tenant auth, uses VRAXIA_ADMIN_KEY env var
function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers["x-admin-key"] as string | undefined;
  const adminKey = env.VRAXIA_ADMIN_KEY;

  if (!adminKey) {
    res.status(503).json({ error: "Admin not configured (VRAXIA_ADMIN_KEY not set)" });
    return;
  }
  if (key !== adminKey) {
    res.status(401).json({ error: "Invalid admin key" });
    return;
  }
  next();
}

adminRouter.use(adminAuth);

// POST /admin/tenants — provision a new tenant
adminRouter.post("/tenants", async (req, res) => {
  const { id, name, plan, modules, keys } = req.body;

  if (!id || !name || !keys?.ANTHROPIC_API_KEY) {
    res.status(400).json({ error: "id, name, and keys.ANTHROPIC_API_KEY are required" });
    return;
  }

  try {
    const record = await provisionTenant({ id, name, plan, modules, keys });
    logger.info("[admin] tenant provisioned", { id: record.id });
    res.status(201).json({
      tenantId: record.id,
      apiKey: record.apiKey,
      plan: record.plan,
      modules: record.modules,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Provisioning failed";
    res.status(400).json({ error: msg });
  }
});

// GET /admin/tenants — list all tenants
adminRouter.get("/tenants", async (_req, res) => {
  try {
    const tenants = await getTenantManager().list();
    res.json({ tenants, total: tenants.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to list tenants" });
  }
});

// POST /admin/tenants/:id/modules — activate/deactivate module
adminRouter.post("/tenants/:id/modules", async (req, res) => {
  const { id } = req.params;
  const { moduleId, action } = req.body as { moduleId: string; action: "activate" | "deactivate" };

  try {
    const manager = getTenantManager();
    if (action === "activate") {
      await manager.activateModule(id, moduleId);
    } else {
      await manager.deactivateModule(id, moduleId);
    }
    res.json({ ok: true, tenantId: id, moduleId, action });
  } catch (err) {
    res.status(500).json({ error: "Failed to update module" });
  }
});
