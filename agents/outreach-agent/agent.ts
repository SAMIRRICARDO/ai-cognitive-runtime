/**
 * OutreachAgent — consultive enterprise outreach for VRASHOWS.
 *
 * Consumes LeadProfile objects from futurecom-researcher and generates
 * personalized, channel-ready communication packages (email + LinkedIn).
 *
 * Architecture:
 * - save_outreach tool forces structured output per company (same pattern as save_lead)
 * - memory_read deduplicates — skips companies already contacted
 * - memory_write records generated outreach for future dedup
 * - Model: Sonnet (creative + structured, cost-balanced)
 * - Memory-aware: reads past sessions to avoid duplicate outreach
 * - Designed for multi-agent workflows: accepts LeadProfile[] directly
 */
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { BaseAgent } from "../_base/agent.js";
import type { ToolHandler, AgentRunOptions } from "../_base/types.js";

import { memoryReadTool, memoryWriteTool } from "../../tools/index.js";
import { logger } from "../../config/logger.js";
import { Models, ModelConfig, getMaxTokens, getMaxIterations } from "../../config/models.js";

import { validateOutreachPackage, saveOutreachInputSchema } from "./schemas.js";
import type {
  OutreachPackage,
  OutreachResult,
  OutreachOptions,
  OutreachRequest,
} from "./types.js";
import type { LeadProfile } from "../futurecom-researcher/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── save_outreach tool ───────────────────────────────────────────────────────

function createSaveOutreachTool(packages: OutreachPackage[]): ToolHandler {
  return {
    name: "save_outreach",
    schema: {
      name: "save_outreach",
      description:
        "Save a complete outreach package for one company. Call once per lead processed.",
      input_schema: saveOutreachInputSchema,
    },
    execute: async (input) => {
      const validation = validateOutreachPackage(input);

      if (!validation.success) {
        const issues = validation.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        logger.warn("[outreach-agent] invalid package rejected", { issues });
        return { success: false, error: `Validation failed: ${issues}` };
      }

      const pkg: OutreachPackage = {
        ...validation.data,
        generatedAt: new Date().toISOString(),
      };

      packages.push(pkg);
      logger.info("[outreach-agent] package saved", {
        company: pkg.company,
        score: pkg.leadScore,
      });

      return { success: true, company: pkg.company };
    },
  };
}

// ─── Agent ────────────────────────────────────────────────────────────────────

export class OutreachAgent extends BaseAgent {
  private packages: OutreachPackage[] = [];

  constructor(systemPrompt: string) {
    super({
      name: "outreach-agent",
      description:
        "Generates consultive enterprise outreach (email + LinkedIn) for VRASHOWS leads",
      systemPrompt,
      model: Models.default,
      maxTokens: getMaxTokens(ModelConfig.maxTokens.extended),
      temperature: ModelConfig.temperature.balanced,
      maxIterations: getMaxIterations(25),
      memoryEnabled: true,
      memorySaveEnabled: false, // outreach packages stored via memory_write explicitly
    });
  }

  static async create(): Promise<OutreachAgent> {
    const promptPath = join(__dirname, "../../prompts/agents/outreach-agent.md");
    const systemPrompt = await readFile(promptPath, "utf8");
    const agent = new OutreachAgent(systemPrompt);
    agent.registerTool(memoryReadTool);
    agent.registerTool(memoryWriteTool);
    agent.registerTool(createSaveOutreachTool(agent.packages));
    return agent;
  }

  // ─── generate: batch processing ───────────────────────────────────────────

  /**
   * Generate outreach packages for a list of leads.
   * Primary entry point for multi-agent workflows.
   */
  async generate(
    leads: LeadProfile[],
    opts: OutreachOptions = {},
    runOptions: AgentRunOptions = {}
  ): Promise<OutreachResult> {
    const {
      channel = "both",
      tone = "consultive",
      event = "Futurecom 2026",
      senderName = "VRASHOWS",
      minScore = 40,
    } = opts;

    this.packages = [];
    const sessionStartedAt = new Date().toISOString();
    const failures: OutreachResult["failures"] = [];

    const eligible = leads.filter((l) => l.initialScore >= minScore);

    logger.info("[outreach-agent] starting batch", {
      total: leads.length,
      eligible: eligible.length,
      skipped: leads.length - eligible.length,
      minScore,
    });

    if (eligible.length === 0) {
      return {
        leadsProcessed: 0,
        packages: [],
        failures,
        sessionStartedAt,
        sessionCompletedAt: new Date().toISOString(),
      };
    }

    const leadsContext = eligible
      .map((l) => this.serializeLead(l))
      .join("\n\n---\n\n");

    const prompt = this.buildBatchPrompt(leadsContext, {
      channel,
      tone,
      event,
      senderName,
      count: eligible.length,
    });

    await this.run(prompt, runOptions);

    // Identify which leads failed (no package generated)
    const processedCompanies = new Set(this.packages.map((p) => p.company.toLowerCase()));
    for (const lead of eligible) {
      if (!processedCompanies.has(lead.company.toLowerCase())) {
        failures.push({ company: lead.company, reason: "No package generated by agent" });
      }
    }

    const sessionCompletedAt = new Date().toISOString();

    logger.info("[outreach-agent] batch complete", {
      generated: this.packages.length,
      failed: failures.length,
    });

    return {
      leadsProcessed: eligible.length,
      packages: this.packages.slice(),
      failures,
      sessionStartedAt,
      sessionCompletedAt,
    };
  }

  // ─── generateSingle: single lead ──────────────────────────────────────────

  /**
   * Generate outreach for a single lead.
   * Useful for on-demand generation in orchestration pipelines.
   */
  async generateSingle(
    request: OutreachRequest,
    runOptions: AgentRunOptions = {}
  ): Promise<OutreachPackage | null> {
    const { lead, options = {} } = request;
    const result = await this.generate([lead], options, runOptions);
    return result.packages[0] ?? null;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private serializeLead(lead: LeadProfile): string {
    return [
      `COMPANY: ${lead.company}`,
      `SEGMENT: ${lead.segment}`,
      `SCORE: ${lead.initialScore}`,
      `BUDGET POTENTIAL: ${lead.budgetPotential}`,
      `EVENT RELEVANCE: ${lead.eventRelevance}`,
      `BOOTH COMPLEXITY: ${lead.boothComplexity}`,
      `WEBSITE: ${lead.website}`,
      `LINKEDIN: ${lead.linkedin}`,
      `STRATEGIC NOTES: ${lead.strategicNotes}`,
      lead.sources.length > 0 ? `SOURCES: ${lead.sources.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private buildBatchPrompt(
    leadsContext: string,
    opts: {
      channel: string;
      tone: string;
      event: string;
      senderName: string;
      count: number;
    }
  ): string {
    return `
Generate consultive outreach packages for ${opts.count} company lead(s) identified for VRASHOWS.

Event context: ${opts.event}
Channel: ${opts.channel}
Tone: ${opts.tone}
Sender: ${opts.senderName}

For EACH company below, call save_outreach with a complete, personalized package.

Apply segment-specific positioning:
- telecom/connectivity/infrastructure → operational reliability and brand credibility at scale
- cloud/saas/enterprise-software → premium experience design reflecting their brand promise
- ai/cybersecurity → precision, controlled environments, executive-level trust
- fintech → institutional solidity and compliance-grade hospitality

LEADS TO PROCESS:

${leadsContext}

Rules:
- Never reuse phrases between companies
- Email: 120-180 words, structured as specified in your instructions
- LinkedIn: 60-90 words, peer-level, no pitch
- Meeting CTA: specific to this company's operational reality
- Call save_outreach for every company before responding
`.trim();
  }
}
