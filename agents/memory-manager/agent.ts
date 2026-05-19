import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { BaseAgent } from "../_base/agent.js";
import { getMaxIterations } from "../../config/models.js";
import { memoryManager, type Memory, type MemoryType } from "../../memory/manager.js";
import { memoryCompressor } from "../../memory/compressor.js";
import { logger } from "../../config/logger.js";
import type { ToolHandler } from "../_base/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Tool definitions ─────────────────────────────────────────────────────────

function buildTools(defaultAgent: string): ToolHandler[] {
  return [
    {
      name: "memory_search",
      schema: {
        name: "memory_search",
        description: "Search memories by semantic similarity.",
        input_schema: {
          type: "object",
          properties: {
            query:          { type: "string" },
            agent_name:     { type: "string" },
            type:           { type: "string", enum: ["episodic", "semantic", "procedural"] },
            limit:          { type: "number" },
            min_importance: { type: "number" },
          },
          required: ["query"],
        },
      },
      execute: async (input) => {
        const i = input as any;
        return memoryManager.search(i.query, {
          agentName: i.agent_name,
          type: i.type as MemoryType | undefined,
          limit: i.limit ?? 8,
          minImportance: i.min_importance ?? 0,
        });
      },
    },

    {
      name: "memory_store",
      schema: {
        name: "memory_store",
        description: "Store a new memory. Use sparingly — only for durable, high-value information.",
        input_schema: {
          type: "object",
          properties: {
            type:        { type: "string", enum: ["episodic", "semantic", "procedural"] },
            content:     { type: "string" },
            context:     { type: "string" },
            agent_name:  { type: "string" },
            importance:  { type: "number", description: "0.0 – 1.0" },
            tags:        { type: "array", items: { type: "string" } },
            episode_id:  { type: "string", description: "UUID of the current episode (optional)" },
          },
          required: ["type", "content", "importance"],
        },
      },
      execute: async (input) => {
        const i = input as any;
        const id = await memoryManager.store({
          type: i.type,
          content: i.content,
          context: i.context ?? "",
          agentName: i.agent_name ?? defaultAgent,
          importance: i.importance,
          tags: i.tags ?? [],
        });
        if (i.episode_id) await memoryCompressor.attachToEpisode(id, i.episode_id);
        return { id, stored: true };
      },
    },

    {
      name: "memory_update",
      schema: {
        name: "memory_update",
        description: "Update content, importance, or tags of a memory.",
        input_schema: {
          type: "object",
          properties: {
            id:         { type: "string" },
            content:    { type: "string" },
            importance: { type: "number" },
            tags:       { type: "array", items: { type: "string" } },
          },
          required: ["id"],
        },
      },
      execute: async (input) => {
        const i = input as any;
        await memoryManager.update(i.id, { content: i.content, importance: i.importance, tags: i.tags });
        return { updated: true };
      },
    },

    {
      name: "memory_delete",
      schema: {
        name: "memory_delete",
        description: "Delete a memory by ID. Only use after confirming it is truly redundant.",
        input_schema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
      execute: async (input) => {
        await memoryManager.delete((input as any).id);
        return { deleted: true };
      },
    },

    {
      name: "episode_begin",
      schema: {
        name: "episode_begin",
        description: "Start a new episodic memory session. Returns the episode_id to use when storing memories.",
        input_schema: {
          type: "object",
          properties: { agent_name: { type: "string" } },
          required: ["agent_name"],
        },
      },
      execute: async (input) => {
        const id = await memoryCompressor.beginEpisode((input as any).agent_name);
        return { episode_id: id };
      },
    },

    {
      name: "episode_end",
      schema: {
        name: "episode_end",
        description: "Close an episode. Generates a summary of all memories in the episode.",
        input_schema: {
          type: "object",
          properties: { episode_id: { type: "string" } },
          required: ["episode_id"],
        },
      },
      execute: async (input) => {
        return memoryCompressor.endEpisode((input as any).episode_id);
      },
    },

    {
      name: "episode_list",
      schema: {
        name: "episode_list",
        description: "List recent episodes for an agent.",
        input_schema: {
          type: "object",
          properties: {
            agent_name: { type: "string" },
            limit:      { type: "number" },
          },
          required: ["agent_name"],
        },
      },
      execute: async (input) => {
        const i = input as any;
        return memoryCompressor.getEpisodes(i.agent_name, i.limit ?? 10);
      },
    },

    {
      name: "compress_clusters",
      schema: {
        name: "compress_clusters",
        description: "Find semantic clusters of related memories and compress each into one denser memory. Uses Sonnet for synthesis.",
        input_schema: {
          type: "object",
          properties: { agent_name: { type: "string" } },
        },
      },
      execute: async (input) => {
        return memoryCompressor.compressSemanticClusters((input as any).agent_name);
      },
    },

    {
      name: "incremental_summarize",
      schema: {
        name: "incremental_summarize",
        description: "Summarize oldest episodic memories into a rolling summary when count exceeds threshold (8). Keeps episodic memory bounded.",
        input_schema: {
          type: "object",
          properties: { agent_name: { type: "string" } },
          required: ["agent_name"],
        },
      },
      execute: async (input) => {
        return memoryCompressor.incrementalSummarize((input as any).agent_name);
      },
    },

    {
      name: "deduplicate",
      schema: {
        name: "deduplicate",
        description: "Remove true duplicate memories. Uses Haiku to confirm semantic equivalence before deleting (avoids false positives).",
        input_schema: {
          type: "object",
          properties: { agent_name: { type: "string" } },
        },
      },
      execute: async (input) => {
        return memoryCompressor.deduplicateCheap((input as any).agent_name);
      },
    },

    {
      name: "memory_stats",
      schema: {
        name: "memory_stats",
        description: "Get memory statistics broken down by type and agent.",
        input_schema: {
          type: "object",
          properties: { agent_name: { type: "string" } },
        },
      },
      execute: async (input) => memoryManager.stats((input as any).agent_name),
    },
  ];
}

// ─── MemoryManagerAgent ───────────────────────────────────────────────────────

export class MemoryManagerAgent extends BaseAgent {
  constructor() {
    super({
      name: "memory-manager",
      description: "Manages agent memory: compression, summarization, dedup, episodic lifecycle",
      systemPrompt: "",
      model: "auto",
      maxIterations: getMaxIterations(20),
    });
  }

  static async create(defaultAgent = "global"): Promise<MemoryManagerAgent> {
    await memoryManager.initialize();
    await memoryCompressor.initialize();

    const agent = new MemoryManagerAgent();
    const promptPath = join(__dirname, "../../prompts/agents/memory-manager.md");
    agent.config.systemPrompt = await readFile(promptPath, "utf8");

    for (const tool of buildTools(defaultAgent)) {
      agent.registerTool(tool);
    }

    return agent;
  }

  // ── High-level operations ─────────────────────────────────────────────────────

  /**
   * Extract durable memories from an agent run. Uses Haiku for cheap classification.
   * Returns stored memories.
   */
  async extractFromRun(opts: {
    agentName: string;
    userMessage: string;
    agentOutput: string;
    episodeId?: string;
  }): Promise<Memory[]> {
    const prompt = [
      `Agent: ${opts.agentName}`,
      `User: ${opts.userMessage}`,
      `Output:\n${opts.agentOutput.slice(0, 3000)}`,
      "",
      "Extract memories worth preserving. Importance >= 0.3 only.",
      "Output JSON array.",
    ].join("\n");

    const result = await this.run(prompt);

    const match =
      result.output.match(/```json\n?([\s\S]*?)\n?```/) ??
      result.output.match(/(\[[\s\S]*?\])/);

    if (!match) return [];

    let memories: Memory[] = [];
    try {
      const parsed = JSON.parse(match[1]) as Array<Partial<Memory>>;
      memories = parsed
        .filter((m) => m.content && m.type && (m.importance ?? 0) >= 0.3)
        .map((m) => ({
          type: m.type!,
          content: m.content!,
          context: m.context ?? `${opts.agentName} run`,
          agentName: opts.agentName,
          importance: m.importance ?? 0.5,
          tags: m.tags ?? [],
        }));
    } catch {
      logger.warn("[memory-manager] parse failed");
      return [];
    }

    for (const memory of memories) {
      const id = await memoryManager.store(memory);
      if (opts.episodeId) await memoryCompressor.attachToEpisode(id, opts.episodeId);
    }

    logger.info("[memory-manager] extracted", { count: memories.length, agent: opts.agentName });
    return memories;
  }

  /**
   * Full maintenance cycle: dedup → compress → incremental summarize → prune.
   * Designed to run periodically (e.g. after every 5 runs or on schedule).
   */
  async maintain(agentName?: string): Promise<{
    deduped: number;
    compressed: number;
    summarized: number;
    pruned: number;
    totalCostUsd: number;
  }> {
    logger.info("[memory-manager] maintenance start", { agentName });

    const dedup = await memoryCompressor.deduplicateCheap(agentName);
    const compress = await memoryCompressor.compressSemanticClusters(agentName);

    let summarized = 0;
    let summarizeCost = 0;
    if (agentName) {
      const s = await memoryCompressor.incrementalSummarize(agentName);
      summarized = s.memoriesMerged;
      summarizeCost = s.tokenCost;
    }

    const pruned = await memoryManager.prune(agentName);

    const totalCostUsd = dedup.tokenCost + compress.tokenCost + summarizeCost;

    logger.info("[memory-manager] maintenance done", {
      deduped: dedup.removed,
      compressed: compress.memoriesCompressed,
      summarized,
      pruned,
      totalCostUsd,
    });

    return {
      deduped: dedup.removed,
      compressed: compress.memoriesCompressed,
      summarized,
      pruned,
      totalCostUsd,
    };
  }
}
