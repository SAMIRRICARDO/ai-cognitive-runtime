import { searchLocalMemory } from "../memory/local-rag.js";
import type { ToolHandler } from "../agents/_base/types.js";

export const searchLeadsRagTool: ToolHandler = {
  name: "search_leads_rag",
  schema: {
    name: "search_leads_rag",
    description:
      "Busca leads na base de conhecimento RAG local (363 leads indexados) por qualquer termo livre: " +
      "nome, empresa, cargo, email, status (HOT/WARM), campanha, segmento. " +
      "Use para responder perguntas sobre contatos sem precisar de filtros exatos. " +
      "Exemplos: 'leads HOT da Microsoft', 'CTOs de telecom', 'quem é Patricia da campanha TOTVS'.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Termo de busca livre — nome, empresa, cargo, status, campanha, segmento, etc.",
        },
        limit: {
          type: "number",
          description: "Número máximo de resultados (padrão 10, máx 30)",
        },
        include_campaigns: {
          type: "boolean",
          description: "Se true, inclui resumos de campanha nos resultados (padrão false)",
        },
      },
      required: ["query"],
    },
  },
  execute: async (input) => {
    const { query, limit = 10, include_campaigns = false } =
      input as { query: string; limit?: number; include_campaigns?: boolean };

    const collections: ("leads" | "campaigns")[] = include_campaigns
      ? ["leads", "campaigns"]
      : ["leads"];

    const results = searchLocalMemory({ query, collections, limit: Math.min(limit, 30) });

    if (results.length === 0) {
      return { found: 0, message: `Nenhum lead encontrado para: "${query}"` };
    }

    return {
      found: results.length,
      query,
      leads: results.map((r) => ({
        relevance: r.score,
        ...(r.metadata as Record<string, unknown>),
        content: r.content,
      })),
    };
  },
};
