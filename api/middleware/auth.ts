import type { Request, Response, NextFunction } from "express";
import { getTenantManager } from "../../tenant/manager.js";
import type { TenantConfig, TenantEnv } from "../../tenant/types.js";

export interface AuthenticatedRequest extends Request {
  tenant: TenantConfig;
  tenantEnv: TenantEnv;
}

export async function tenantAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = req.headers["x-api-key"] as string | undefined;

  if (!apiKey) {
    res.status(401).json({ error: "Missing X-Api-Key header" });
    return;
  }

  try {
    const manager = getTenantManager();

    const tenant = await manager.getByApiKey(apiKey);
    if (!tenant) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    const tenantEnv = await manager.getKeys(tenant.id);
    if (!tenantEnv) {
      res.status(503).json({ error: "Tenant API keys not configured. Complete onboarding first." });
      return;
    }

    (req as AuthenticatedRequest).tenant = tenant;
    (req as AuthenticatedRequest).tenantEnv = tenantEnv;
    next();
  } catch (err) {
    res.status(500).json({ error: "Authentication service unavailable" });
  }
}
