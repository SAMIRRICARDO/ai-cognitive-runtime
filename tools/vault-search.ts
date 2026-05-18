import { vaultIndex } from "../memory/long-term/vault-index.js";
import type { ToolHandler } from "../agents/_base/types.js";

export const vaultSearchTool: ToolHandler = {
  name: "vault_search",
  schema: {
    name: "vault_search",
    description:
      "Search the Obsidian vault using hybrid retrieval (semantic + keyword + recency). Returns the most relevant note excerpts with file paths and section headings.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language search query",
        },
        limit: {
          type: "number",
          description: "Max results to return (default 6)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Filter by note tags (optional)",
        },
        mode: {
          type: "string",
          enum: ["hybrid", "semantic", "keyword"],
          description: "Retrieval mode. Default: hybrid",
        },
      },
      required: ["query"],
    },
  },
  execute: async (input) => {
    const { query, limit = 6, tags, mode = "hybrid" } = input as {
      query: string;
      limit?: number;
      tags?: string[];
      mode?: "hybrid" | "semantic" | "keyword";
    };

    let results;

    if (mode === "semantic") {
      results = await vaultIndex.search(query, { limit, tags });
    } else if (mode === "keyword") {
      results = await vaultIndex.hybridSearch(query, {
        limit,
        tags,
        weights: { semantic: 0, keyword: 1, recency: 0 },
      });
    } else {
      results = await vaultIndex.hybridSearch(query, { limit, tags });
    }

    if (results.length === 0) {
      return { message: "No relevant notes found.", results: [] };
    }

    return {
      results: results.map((r) => ({
        file: r.filePath,
        title: r.title,
        section: r.section,
        score: r.score.toFixed(3),
        tags: r.tags,
        links: r.links,
        content: r.content,
      })),
    };
  },
};
