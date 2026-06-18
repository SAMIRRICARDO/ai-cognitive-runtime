import path from "node:path";
import { fileURLToPath } from "node:url";
import { BaseAgent } from "../../agents/_base/agent.js";
import { SkillRegistry } from "./skill-registry.js";
import {
  createListSkillsTool,
  createSearchSkillsTool,
  createRunSkillTool,
} from "./skill-tools.js";
import { Models, getMaxTokens } from "../../config/models.js";
import type { AgentConfig } from "../../agents/_base/types.js";
import type { TenantEnv } from "../../tenant/types.js";

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

    // Register the 3 core skill tools
    this.registerTool(createListSkillsTool(this.registry));
    this.registerTool(createSearchSkillsTool(this.registry));
    this.registerTool(createRunSkillTool(this.registry));
  }

  getSkillCount(): number {
    return this.registry.count();
  }

  getModuleId(): string {
    return this.moduleId;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function buildModuleSystemPrompt(cfg: ModuleConfig, skillCount: number): string {
  return `Você é o agente de **${cfg.department}** do sistema VRAXIA.

Seu papel: ajudar profissionais e empresas com tarefas de ${cfg.department.toLowerCase()} usando uma biblioteca de ${skillCount} skills especializadas.

## Como operar

1. **Entenda o pedido** do usuário com precisão
2. **Busque a skill certa** usando \`search_skills\` com palavras-chave relevantes
3. **Recupere o prompt** com \`run_skill\` passando o id correto
4. **Execute e entregue** o resultado personalizado com o contexto do usuário
5. Se não encontrar uma skill específica, use \`list_skills\` para explorar o catálogo

## Regras

- Sempre prefira uma skill específica a uma resposta genérica
- Se o usuário não deu todos os dados necessários para a skill, peça antes de executar
- Entregue resultados prontos para uso — não apenas o template
- Nunca invente informações — se faltar dado, pergunte
- Seja direto e profissional: menos explicação, mais entrega

## Departamento
${cfg.department} — ${cfg.description}`;
}
