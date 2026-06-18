import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BaseModuleAgent, buildModuleSystemPrompt } from "./module-agent.js";
import { SkillRegistry } from "./skill-registry.js";
import { Models, getMaxTokens } from "../../config/models.js";
import type { TenantEnv } from "../../tenant/types.js";

const require = createRequire(import.meta.url);

export interface ModuleAgentOptions {
  tenantId?: string;
  tenantEnv?: TenantEnv;
}

// ── Concrete agent class ───────────────────────────────────────────────────────

class DepartmentAgent extends BaseModuleAgent {
  private constructor(cfg: ConstructorParameters<typeof BaseModuleAgent>[0]) {
    super(cfg);
  }

  static build(
    moduleId: string,
    moduleMeta: Record<string, string>,
    skillsDir: string,
    opts: ModuleAgentOptions = {}
  ): DepartmentAgent {
    // Peek at skill count before constructing so we can embed it in the prompt
    const registry = new SkillRegistry(skillsDir, moduleId);
    registry.load();
    const count = registry.count();

    const systemPrompt = buildModuleSystemPrompt(
      {
        id: moduleId,
        name: moduleMeta.name,
        description: moduleMeta.description,
        department: moduleMeta.department,
        skillsDir,
        systemPrompt: "",
        tenantId: opts.tenantId,
        tenantEnv: opts.tenantEnv,
      },
      count
    );

    return new DepartmentAgent({
      name: moduleId,
      description: moduleMeta.description,
      model: Models.default,
      maxTokens: getMaxTokens(),
      systemPrompt,
      moduleId,
      skillsDir,
      tenantId: opts.tenantId,
      tenantEnv: opts.tenantEnv,
    });
  }
}

// ── Public factory function ────────────────────────────────────────────────────

export function createDepartmentAgent(
  moduleId: string,
  opts: ModuleAgentOptions = {}
): BaseModuleAgent {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const moduleRoot = path.resolve(__dirname, `../${moduleId}`);
  const moduleMeta = require(path.join(moduleRoot, "module.json")) as Record<string, string>;
  const skillsDir = path.join(moduleRoot, "skills");

  return DepartmentAgent.build(moduleId, moduleMeta, skillsDir, opts);
}
