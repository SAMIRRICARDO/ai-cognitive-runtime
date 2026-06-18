import type { ToolHandler } from "../../agents/_base/types.js";
import type { SkillRegistry, Skill } from "./skill-registry.js";

// ── list_skills ───────────────────────────────────────────────────────────────

export function createListSkillsTool(registry: SkillRegistry): ToolHandler {
  return {
    name: "list_skills",
    schema: {
      name: "list_skills",
      description:
        "Lista todas as skills disponíveis no módulo. Use para descobrir o que está disponível antes de escolher uma skill.",
      input_schema: {
        type: "object" as const,
        properties: {
          filter: {
            type: "string",
            description: "Filtro opcional por palavra-chave no nome ou descrição",
          },
        },
        required: [],
      },
    },
    execute: async (input) => {
      const filter = (input.filter as string | undefined)?.toLowerCase();
      const skills = filter ? registry.search(filter, 20) : registry.getAll();
      return {
        total: registry.count(),
        shown: skills.length,
        skills: skills.map((s) => ({ id: s.id, name: s.name, description: s.description, tags: s.tags })),
      };
    },
  };
}

// ── search_skills ─────────────────────────────────────────────────────────────

export function createSearchSkillsTool(registry: SkillRegistry): ToolHandler {
  return {
    name: "search_skills",
    schema: {
      name: "search_skills",
      description:
        "Busca skills relevantes para uma tarefa específica. Retorna as mais relevantes pelo nome e descrição.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "O que o usuário precisa fazer. Ex: 'análise de fluxo de caixa', 'contrato de serviços'",
          },
          limit: {
            type: "number",
            description: "Número máximo de resultados. Default: 5",
          },
        },
        required: ["query"],
      },
    },
    execute: async (input) => {
      const query = input.query as string;
      const limit = (input.limit as number | undefined) ?? 5;
      const results = registry.search(query, limit);
      if (results.length === 0) {
        return { found: false, message: "Nenhuma skill encontrada para essa busca.", skills: [] };
      }
      return {
        found: true,
        skills: results.map((s) => ({ id: s.id, name: s.name, description: s.description, tags: s.tags })),
      };
    },
  };
}

// ── run_skill ─────────────────────────────────────────────────────────────────

export function createRunSkillTool(registry: SkillRegistry): ToolHandler {
  return {
    name: "run_skill",
    schema: {
      name: "run_skill",
      description:
        "Retorna o prompt completo de uma skill para que você possa executá-lo com o contexto do usuário. Sempre use search_skills primeiro para encontrar o id correto.",
      input_schema: {
        type: "object" as const,
        properties: {
          skill_id: {
            type: "string",
            description: "O id da skill (campo 'id' retornado por list_skills ou search_skills)",
          },
        },
        required: ["skill_id"],
      },
    },
    execute: async (input) => {
      const id = input.skill_id as string;
      const skill = registry.getById(id);
      if (!skill) {
        const suggestions = registry.search(id, 3);
        return {
          found: false,
          error: `Skill '${id}' não encontrada.`,
          suggestions: suggestions.map((s) => ({ id: s.id, name: s.name })),
        };
      }
      return {
        found: true,
        id: skill.id,
        name: skill.name,
        description: skill.description,
        prompt: skill.prompt || skill.content,
      };
    },
  };
}
