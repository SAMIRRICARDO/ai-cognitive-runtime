import path from "node:path";
import { fileURLToPath } from "node:url";
import { BaseAgent } from "../../agents/_base/agent.js";
import { SkillRegistry } from "./skill-registry.js";
import {
  createListSkillsTool,
  createSearchSkillsTool,
  createRunSkillTool,
} from "./skill-tools.js";
import { Models, ModelConfig, getMaxTokens, getMaxIterations } from "../../config/models.js";
import { env, isCheapMode } from "../../config/env.js";
import type { AgentConfig } from "../../agents/_base/types.js";
import type { TenantEnv } from "../../tenant/types.js";

// ── Lazy tool imports (avoid crashing if infra is down) ──────────────────────

async function safeImportVaultTool() {
  try {
    const { vaultSearchTool } = await import("../../tools/vault-search.js");
    return vaultSearchTool;
  } catch {
    return null;
  }
}

async function safeImportMemoryTools() {
  try {
    const { memoryReadTool, memoryWriteTool } = await import("../../tools/memory-tool.js");
    return { memoryReadTool, memoryWriteTool };
  } catch {
    return null;
  }
}

// ── Config helpers ────────────────────────────────────────────────────────────

const memoryInfraAvailable =
  env.ENABLE_MEMORY !== "false" &&
  !!env.DATABASE_URL &&
  !!env.OPENAI_API_KEY;

const redisAvailable =
  env.ENABLE_MEMORY !== "false";

export interface ModuleConfig {
  id: string;
  name: string;
  description: string;
  department: string;
  skillsDir: string;
  systemPrompt: string;
  tenantId?: string;
  tenantEnv?: TenantEnv;
}

export abstract class BaseModuleAgent extends BaseAgent {
  protected registry: SkillRegistry;
  readonly moduleId: string;

  constructor(config: AgentConfig & { moduleId: string; skillsDir: string }) {
    super(config);
    this.moduleId = config.moduleId;
    this.registry = new SkillRegistry(config.skillsDir, config.moduleId);
    this.registry.load();

    // Core skill tools — always registered
    this.registerTool(createListSkillsTool(this.registry));
    this.registerTool(createSearchSkillsTool(this.registry));
    this.registerTool(createRunSkillTool(this.registry));

    // RAG + memory tools — async registration after construction
    this._registerContextTools();
  }

  // Registers vault + Redis tools without blocking the constructor
  private _registerContextTools(): void {
    if (isCheapMode) return; // skip in cheap/dev mode — not cost-effective

    if (memoryInfraAvailable) {
      safeImportVaultTool().then((tool) => {
        if (tool) this.registerTool(tool);
      });
    }

    if (redisAvailable) {
      safeImportMemoryTools().then((tools) => {
        if (tools) {
          this.registerTool(tools.memoryReadTool);
          this.registerTool(tools.memoryWriteTool);
        }
      });
    }
  }

  getSkillCount(): number {
    return this.registry.count();
  }

  getModuleId(): string {
    return this.moduleId;
  }
}

// ── System prompt factory ─────────────────────────────────────────────────────

export function buildModuleSystemPrompt(cfg: ModuleConfig, skillCount: number): string {
  const hasVault = memoryInfraAvailable && !isCheapMode;
  const hasMemory = redisAvailable && !isCheapMode;

  const contextTools = [
    hasVault ? "`vault_search` — busca semântica no Obsidian vault (conhecimento institucional, ADRs, decisões, contexto de negócio)" : null,
    hasMemory ? "`memory_read` / `memory_write` — memória de curto prazo (Redis) para manter contexto entre turnos" : null,
  ].filter(Boolean);

  const contextSection = contextTools.length > 0 ? `
## Ferramentas de Contexto e RAG

Antes de raciocinar, recupere contexto relevante:
${contextTools.map((t) => `- ${t}`).join("\n")}

**Prioridade de execução:**
1. \`vault_search\` — busque contexto no vault antes de qualquer resposta
2. \`search_skills\` — encontre a skill adequada
3. \`run_skill\` — execute o prompt da skill com os dados do usuário
4. Raciocínio próprio — somente se nenhuma fonte acima resolver
` : `
## Ferramentas disponíveis

1. \`search_skills\` — encontre a skill adequada para o pedido
2. \`run_skill\` — execute o prompt da skill com os dados do usuário
3. \`list_skills\` — explore o catálogo quando não souber por onde começar
`;

  return `Você é o agente de **${cfg.department}** do sistema VRAXIA OS.

Sua função: ajudar profissionais e empresas com tarefas de ${cfg.department.toLowerCase()} usando uma biblioteca de **${skillCount} skills especializadas** e memória contextual.
${contextSection}
## Como operar

1. **Entenda o pedido** com precisão — pergunte o que faltar antes de executar
2. **Recupere contexto** via vault_search quando o pedido envolver decisões, clientes ou histórico
3. **Encontre a skill certa** com \`search_skills\` usando palavras-chave do pedido
4. **Execute e personalize** via \`run_skill\` — entregue o resultado adaptado ao contexto real do usuário
5. **Não invente dados** — se o usuário não forneceu algo necessário, peça

## Regras

- Prefira sempre uma skill específica a uma resposta genérica
- Entregue resultados prontos para uso — não templates com lacunas
- Seja direto: menos explicação, mais entrega
- Custo importa: use vault e skills para evitar raciocínio desnecessário da LLM

## Departamento

**${cfg.department}** — ${cfg.description}`;
}
