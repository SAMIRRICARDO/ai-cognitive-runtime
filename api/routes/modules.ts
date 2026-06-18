import { Router } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import fs from "node:fs";
import { AVAILABLE_MODULES } from "../../modules/index.js";
import { SkillRegistry } from "../../modules/_base/skill-registry.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { isDemoMode } from "../../config/env.js";
import { isDemoPreview, DEMO_ENTERPRISE_MESSAGE } from "../../config/demo-config.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const modulesRouter = Router();

function getModuleMeta(moduleId: string) {
  const moduleRoot = path.resolve(__dirname, `../../modules/${moduleId}`);
  try {
    return require(path.join(moduleRoot, "module.json")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getSkillCount(moduleId: string): number {
  const skillsDir = path.resolve(__dirname, `../../modules/${moduleId}/skills`);
  if (!fs.existsSync(skillsDir)) return 0;
  return fs.readdirSync(skillsDir).filter((f) => f.endsWith(".md")).length;
}

// GET /api/modules — list all modules (marks which are active for tenant)
modulesRouter.get("/", (req, res) => {
  const tenant = (req as unknown as AuthenticatedRequest).tenant;
  const activeModules = tenant?.modules ?? AVAILABLE_MODULES;

  const modules = AVAILABLE_MODULES.map((id) => {
    const meta = getModuleMeta(id);
    if (!meta) return null;
    const preview = isDemoMode && isDemoPreview(id);
    return {
      id,
      name: meta.name,
      description: meta.description,
      department: meta.department,
      skillCount: getSkillCount(id),
      active: activeModules.includes(id),
      preview,
      demo_message: preview ? DEMO_ENTERPRISE_MESSAGE : undefined,
      plan_min: meta.plan_min ?? "starter",
      tags: meta.tags ?? [],
    };
  }).filter(Boolean);

  res.json({ modules, total: modules.length });
});

// GET /api/modules/:id — module details + skill list
modulesRouter.get("/:id", (req, res) => {
  const { id } = req.params;
  const meta = getModuleMeta(id);
  if (!meta) {
    res.status(404).json({ error: `Module '${id}' not found` });
    return;
  }

  const skillsDir = path.resolve(__dirname, `../../modules/${id}/skills`);
  const registry = new SkillRegistry(skillsDir, id);
  registry.load();

  const tenant = (req as unknown as AuthenticatedRequest).tenant;
  const active = !tenant || tenant.modules.includes(id);

  res.json({
    id,
    ...meta,
    active,
    skillCount: registry.count(),
    skills: registry.getAll().map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      tags: s.tags,
    })),
  });
});

// POST /api/modules/:id/search — search skills
modulesRouter.post("/:id/search", (req, res) => {
  const { id } = req.params;
  const { query, limit = 8 } = req.body as { query: string; limit?: number };

  if (!query) {
    res.status(400).json({ error: "query is required" });
    return;
  }

  const skillsDir = path.resolve(__dirname, `../../modules/${id}/skills`);
  if (!fs.existsSync(skillsDir)) {
    res.status(404).json({ error: `Module '${id}' not found` });
    return;
  }

  const registry = new SkillRegistry(skillsDir, id);
  registry.load();
  const results = registry.search(query, limit);

  res.json({
    moduleId: id,
    query,
    results: results.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      tags: s.tags,
    })),
  });
});
