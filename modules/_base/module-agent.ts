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

    // Core skill tools — always registered synchronously
    this.registerTool(createListSkillsTool(this.registry));
    this.registerTool(createSearchSkillsTool(this.registry));
    this.registerTool(createRunSkillTool(this.registry));

    // Data tools (query_leads, search_leads_rag) and context tools are
    // registered asynchronously via initDataTools() + _registerContextTools().
    // Call await agent.initDataTools() before agent.run() in the factory.
    this._registerContextTools();
  }

  // Registers module-specific data tools — must be awaited before agent.run()
  async initDataTools(): Promise<void> {
    // VRAXIA Sense: classify_linkedin_reply disponível em todos os módulos
    await import("../../tools/classify-linkedin-reply.js")
      .then(({ classifyLinkedInReplyTool }) => this.registerTool(classifyLinkedInReplyTool))
      .catch(() => {});

    if (this.moduleId === "comercial") {
      await Promise.allSettled([
        import("../../tools/prospect-leads.js").then(({ prospectLeadsTool }) => {
          this.registerTool(prospectLeadsTool);
        }),
        import("../../tools/query-leads.js").then(({ queryLeadsTool }) => {
          this.registerTool(queryLeadsTool);
        }),
        import("../../tools/search-leads-rag.js").then(({ searchLeadsRagTool }) => {
          this.registerTool(searchLeadsRagTool);
        }),
        import("../../tools/find-new-leads.js").then(({ findNewLeadsTool }) => {
          this.registerTool(findNewLeadsTool);
        }),
        import("../../tools/enrich-leads.js").then(({ enrichLeadsTool }) => {
          this.registerTool(enrichLeadsTool);
        }),
        import("../../tools/validate-leads-tool.js").then(({ validateLeadsTool }) => {
          this.registerTool(validateLeadsTool);
        }),
      ]);
    }
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
  const isComercial = cfg.id === "comercial";

  const contextTools = [
    hasVault ? "`vault_search` — busca semântica no Obsidian vault (conhecimento institucional, ADRs, decisões, contexto de negócio)" : null,
    hasMemory ? "`memory_read` / `memory_write` — memória de curto prazo (Redis) para manter contexto entre turnos" : null,
    // VRAXIA Sense — disponível em TODOS os módulos
    "`classify_linkedin_reply` — **VRAXIA Sense**: classifica uma resposta recebida no LinkedIn. Detecta intent, decision_power, score 1-10 e próximo passo. Se handoff=true, envia alerta automático no Telegram.",
    isComercial ? "`search_leads_rag` — busca livre na base de leads indexados: por nome, empresa, cargo, status, campanha, segmento" : null,
    isComercial ? "`query_leads` — consulta estruturada de leads com filtros por status, campanha, empresa" : null,
    isComercial ? "`prospect_leads` — **PRINCIPAL: busca + enriquece leads completos em UMA chamada**. Retorna nome, cargo, empresa, email, LinkedIn, fonte. Use SEMPRE que o usuário pedir leads novos." : null,
    isComercial ? "`find_new_leads` — busca NOVOS leads via web search sem enriquecimento (use só se prospect_leads falhar)" : null,
    isComercial ? "`enrich_company` — **enriquece empresas já conhecidas** com decisores B2B: nome, cargo, email inferido, LinkedIn e score de prioridade (30-90s por empresa)" : null,
    isComercial ? "`validate_leads` — **valida e analisa** a base existente: HOT/WARM/INVALID, cobertura de email, top leads prontos para prospectar" : null,
  ].filter(Boolean);

  const senseInstruction = `
## VRAXIA Sense — Classificador de Respostas LinkedIn

Use \`classify_linkedin_reply\` quando o usuário colar uma mensagem/resposta recebida no LinkedIn:
- "classifica essa resposta: [texto]"
- "o que acha dessa resposta do LinkedIn?"
- "esse lead vale a pena? ele respondeu: [texto]"
- "analisa essa mensagem que recebi: [texto]"

O tool retorna: variant (A-E), intent (high/medium/low/none), decision_power, score 1-10, próximo passo.
Se \`handoff=true\`, envia alerta automático no Telegram — informe o usuário.
`;

  const contextSection = contextTools.length > 0 ? `
## Ferramentas de Contexto, Leads e Prospecção

${contextTools.map((t) => `- ${t}`).join("\n")}
${senseInstruction}
## ⚡ REGRA ABSOLUTA — Busca de Leads

**Quando o usuário pedir "buscar lead", "encontrar decisor", "prospectar", "me traga um lead", "lead novo", "lead de [segmento]":**

1. Execute \`prospect_leads\` IMEDIATAMENTE — sem perguntar, sem consultar base interna, sem etapas intermediárias.
2. O tool já faz tudo automaticamente: busca na web → extrai contato → infere email por padrão → valida email via busca web → retorna nome + cargo + empresa + email + LinkedIn.
3. Apresente o resultado completo para o usuário — todos os campos retornados.
4. NÃO use \`query_leads\` ou \`search_leads_rag\` quando o pedido for por leads NOVOS/EXTERNOS.

**Como mapear o pedido do usuário para os parâmetros de prospect_leads:**
| O usuário diz | Parâmetro | Valor |
|---|---|---|
| "setor de tecnologia" / "tech" | \`segment\` | "tecnologia" |
| "diretoria" / "diretores" | \`role_focus\` | "Diretor" |
| "marketing" (área) | \`role_focus\` | combinar: "Diretor de Marketing" |
| "diretoria de marketing" | \`role_focus\` | "Diretor de Marketing" |
| "diretoria, marketing, tecnologia" | \`role_focus\` | "Diretor de Marketing de Tecnologia" |
| "CMO" / "CTO" / "CEO" | \`role_focus\` | exatamente o cargo citado |
| São Paulo / Brasil | \`location\` | localização citada |

**Exemplo correto:** pedido "lead do setor de tecnologia, diretoria, marketing" →
\`prospect_leads({ query: "Diretor Marketing empresa tecnologia", segment: "tecnologia", role_focus: "Diretor de Marketing", location: "Brasil" })\`

**Quando usar cada ferramenta:**
| Pedido | Ferramenta |
|--------|-----------|
| "buscar lead", "prospectar", "encontrar decisor", "lead novo" | \`prospect_leads\` direto |
| "quantos leads HOT temos?" / "validar nossa base" | \`validate_leads\` |
| "quem são os leads da TOTVS na nossa base?" | \`search_leads_rag\` ou \`query_leads\` |
| "enriquecer Claro, Vivo, TIM" / "quem é o CMO da AWS?" | \`enrich_company\` |
| "classifica essa resposta do LinkedIn: [texto]" | \`classify_linkedin_reply\` |

**NUNCA:** consulte a base interna (\`query_leads\`/\`search_leads_rag\`) quando o usuário pedir lead novo ou externo.
**SEMPRE:** entregue o resultado completo sem pedir confirmação.
**IMPORTANTE:** Para \`enrich_company\`, avise que pode levar 30-90s.
` : `
## Ferramentas disponíveis

1. \`search_skills\` — encontre a skill adequada para o pedido
2. \`run_skill\` — execute o prompt da skill com os dados do usuário
3. \`list_skills\` — explore o catálogo quando não souber por onde começar
${senseInstruction}
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
