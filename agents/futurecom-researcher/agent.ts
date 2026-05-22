/**
 * FuturecomResearcherAgent — enterprise lead intelligence for VRASHOWS.
 *
 * Identifies companies exhibiting at Futurecom 2026 with high potential
 * for 360° event operations partnership with VRASHOWS.
 */

import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { BaseAgent } from "../_base/agent.js";
import type { ToolHandler, AgentRunOptions } from "../_base/types.js";

import {
  webSearchTool,
  memoryReadTool,
  memoryWriteTool,
} from "../../tools/index.js";

import { logger } from "../../config/logger.js";
import { isCheapMode } from "../../config/env.js";
import { Models, ModelConfig, getMaxTokens, getMaxIterations } from "../../config/models.js";

import {
  validateLeadProfile,
  saveleadInputSchema,
} from "./schemas.js";

import type {
  LeadProfile,
  FuturecomResearchResult,
  FuturecomResearchOptions,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ──────────────────────────────────────────────────────────────
   Save Lead Tool
────────────────────────────────────────────────────────────── */

function createSaveLeadTool(
  leadsRef: () => LeadProfile[]
): ToolHandler {
  return {
    name: "save_lead",

    schema: {
      name: "save_lead",

      description:
        "Save a qualified company lead with structured intelligence. Call once per identified company.",

      input_schema: saveleadInputSchema,
    },

    execute: async (input) => {
      const validation = validateLeadProfile(input);

      if (!validation.success) {
        const issues = validation.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");

        logger.warn(
          "[futurecom-researcher] invalid lead rejected",
          { issues }
        );

        return {
          success: false,
          error: `Validation failed: ${issues}`,
        };
      }

      const lead: LeadProfile = {
        ...validation.data,
        generatedAt: new Date().toISOString(),
      };

      leadsRef().push(lead);

      logger.info(
        "[futurecom-researcher] lead saved",
        {
          company: lead.company,
          score: lead.initialScore,
          segment: lead.segment,
        }
      );

      return {
        success: true,
        company: lead.company,
        score: lead.initialScore,
      };
    },
  };
}

/* ──────────────────────────────────────────────────────────────
   Agent
────────────────────────────────────────────────────────────── */

export class FuturecomResearcherAgent extends BaseAgent {
  private leads: LeadProfile[] = [];

  constructor(systemPrompt: string) {
    super({
      name: "futurecom-researcher",

      description:
        "Enterprise lead intelligence for VRASHOWS event operations",

      systemPrompt,

      model: isCheapMode ? Models.fast : Models.default,

      maxTokens: getMaxTokens(isCheapMode ? ModelConfig.maxTokens.cheap : ModelConfig.maxTokens.extended),

      temperature: ModelConfig.temperature.deterministic,

      maxIterations: getMaxIterations(isCheapMode ? 2 : 20),

      memoryEnabled: !isCheapMode,

      memorySaveEnabled: !isCheapMode,
    });
  }

  static async create(): Promise<FuturecomResearcherAgent> {
    const promptPath = join(
      __dirname,
      "../../prompts/agents/futurecom-researcher.md"
    );

    const systemPrompt = await readFile(promptPath, "utf8");

    const agent = new FuturecomResearcherAgent(systemPrompt);

    agent.registerTool(webSearchTool);

    agent.registerTool(memoryReadTool);

    agent.registerTool(memoryWriteTool);

    agent.registerTool(
      createSaveLeadTool(() => agent.leads)
    );

    return agent;
  }

  /* ──────────────────────────────────────────────────────────
     Research
  ───────────────────────────────────────────────────────── */

  async research(
    query: string,

    opts: FuturecomResearchOptions = {},

    runOptions: AgentRunOptions = {}
  ): Promise<FuturecomResearchResult> {
    const {
      event = "Futurecom 2026",
      minScore = 30,
      maxLeads = 20,
      segments,
    } = opts;
    const leadLimit = Math.min(maxLeads, 25);

    this.leads = [];

    const sessionStartedAt = new Date().toISOString();

    const segmentFilter =
      segments?.length
        ? `Focus on segments: ${segments.join(", ")}.`
        : "";

    const fullQuery = `
Event: ${event}
Task: ${query}
${segmentFilter}
Rules:
- JSON/tool output only
- Max ${leadLimit} companies
- Min score ${minScore}
- Short strategicNotes, max 1 sentence
- No reasoning or explanations
- Use save_lead only for qualified companies
`;

    logger.info(
      "[futurecom-researcher] starting research session",
      {
        event,
        query,
        minScore,
        maxLeads,
      }
    );

    const result = await this.run(
      fullQuery,
      runOptions
    );

    const filtered = this.leads
      .filter((l) => l.initialScore >= minScore)
      .sort((a, b) => b.initialScore - a.initialScore)
      .slice(0, leadLimit);

    const sessionCompletedAt =
      new Date().toISOString();

    const researchResult: FuturecomResearchResult = {
      query,

      leads: filtered,

      researchSummary:
        typeof result === "string"
          ? result
          : result.output,

      totalLeads: filtered.length,

      highPriorityCount: filtered.filter(
        (l) => l.initialScore >= 70
      ).length,

      sessionStartedAt,

      sessionCompletedAt,
    };

    logger.info(
      "[futurecom-researcher] session complete",
      {
        totalLeads: researchResult.totalLeads,

        highPriority:
          researchResult.highPriorityCount,
      }
    );

    return researchResult;
  }
}
