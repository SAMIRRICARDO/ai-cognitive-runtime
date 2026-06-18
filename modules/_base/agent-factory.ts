import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BaseModuleAgent, buildModuleSystemPrompt } from "./module-agent.js";
import { SkillRegistry } from "./skill-registry.js";
import { Models, ModelConfig, getMaxTokens, getMaxIterations } from "../../config/models.js";
import { env, isCheapMode } from "../../config/env.js";
import type { TenantEnv } from "../../tenant/types.js";

const require = createRequire(import.meta.url);

// Whether long-term memory infra (pgvector) is available
const memoryEnabled =
  env.ENABLE_MEMORY !== "false" &&
  !!env.DATABASE_URL &&
  !isCheapMode;

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

      // Model routing: "auto" lets the router pick Haiku/Sonnet/Opus per query.
      // In cheap/dev mode, always Haiku (fast + low cost).
      model: isCheapMode ? Models.fast : "auto",

      // Token caps — keep cheap in dev, allow full output in production
      maxTokens: getMaxTokens(
        isCheapMode ? ModelConfig.maxTokens.cheap : ModelConfig.maxTokens.extended
      ),

      // Temperature: balanced for departmental tasks
      temperature: ModelConfig.temperature.balanced,

      // Iteration cap: enough for skill search + execution + follow-up
      maxIterations: getMaxIterations(isCheapMode ? 3 : 8),

      systemPrompt,
      moduleId,
      skillsDir,

      // Response cache: deduplicate identical skill executions (saves tokens)
      enableResponseCache: !isCheapMode,

      // pgvector semantic memory (requires DATABASE_URL + OPENAI_API_KEY)
      memoryEnabled,

      // Don't auto-save memories from skill executions — too expensive at scale
      memorySaveEnabled: false,

      // Tenant isolation
      tenantId: opts.tenantId,
      tenantEnv: opts.tenantEnv,
    });
  }
}

// ── Public factory function ────────────────────────────────────────────────────

export async function createDepartmentAgent(
  moduleId: string,
  opts: ModuleAgentOptions = {}
): Promise<BaseModuleAgent> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const moduleRoot = path.resolve(__dirname, `../${moduleId}`);
  const moduleMeta = require(path.join(moduleRoot, "module.json")) as Record<string, string>;
  const skillsDir = path.join(moduleRoot, "skills");

  const agent = DepartmentAgent.build(moduleId, moduleMeta, skillsDir, opts);
  // Await async tool registration so all tools are ready before agent.run()
  await agent.initDataTools();
  return agent;
}
