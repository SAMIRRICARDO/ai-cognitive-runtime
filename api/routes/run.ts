import { Router } from "express";
import { createDepartmentAgent } from "../../modules/_base/agent-factory.js";
import { AVAILABLE_MODULES } from "../../modules/index.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { logger } from "../../config/logger.js";

export const runRouter = Router();

function sendSSE(res: import("express").Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// POST /api/run — run a module agent (SSE streaming)
runRouter.post("/", async (req, res) => {
  const { moduleId, message } = req.body as { moduleId: string; message: string };

  if (!moduleId || !message) {
    res.status(400).json({ error: "moduleId and message are required" });
    return;
  }

  if (!AVAILABLE_MODULES.includes(moduleId as any)) {
    res.status(404).json({ error: `Unknown module: ${moduleId}` });
    return;
  }

  const tenant = (req as AuthenticatedRequest).tenant;
  const tenantEnv = (req as AuthenticatedRequest).tenantEnv;

  // Check module is active for this tenant
  if (tenant?.modules?.length && !tenant.modules.includes(moduleId)) {
    res.status(403).json({ error: `Module '${moduleId}' is not active for your plan` });
    return;
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  sendSSE(res, "start", { moduleId, message: `Starting ${moduleId} agent...` });

  try {
    const agent = createDepartmentAgent(moduleId, {
      tenantId: tenant?.id,
      tenantEnv,
    });

    const result = await agent.run(message, {
      onStep: (step) => {
        sendSSE(res, step.type, step);
      },
    });

    sendSSE(res, "done", {
      usage: result.usage,
      cost: result.cost,
      durationMs: result.durationMs,
      iterations: result.iterations,
      fromCache: result.fromCache,
    });
  } catch (err) {
    logger.error("[api/run] agent error", { err, moduleId });
    sendSSE(res, "error", {
      message: err instanceof Error ? err.message : "Agent execution failed",
    });
  } finally {
    res.end();
  }
});
