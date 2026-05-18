import { env } from "../config/env.js";
import type { ToolHandler } from "../agents/_base/types.js";

export const webSearchTool: ToolHandler = {
  name: "web_search",
  schema: {
    name: "web_search",
    description: "Search the web for up-to-date information on a topic.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        max_results: { type: "number", description: "Max results to return (default 5)" },
      },
      required: ["query"],
    },
  },
  execute: async (input) => {
    const { query, max_results = 5 } = input as { query: string; max_results?: number };

    if (!env.TAVILY_API_KEY) {
      return { error: "TAVILY_API_KEY not configured. Set it in .env to enable web search." };
    }

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: env.TAVILY_API_KEY,
        query,
        max_results,
        search_depth: "advanced",
      }),
    });

    if (!response.ok) {
      return { error: `Search failed: ${response.statusText}` };
    }

    const data = (await response.json()) as {
      results: Array<{ title: string; url: string; content: string }>;
    };

    return data.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content.slice(0, 500),
    }));
  },
};
