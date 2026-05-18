/**
 * LeadEnrichmentAgent — B2B contact intelligence for VRASHOWS.
 *
 * Enriches company leads with decision maker profiles:
 * name, role, LinkedIn, inferred email, area, priority.
 *
 * Architecture:
 * - save_contact tool: one call per person found (structured output)
 * - web_search: finds LinkedIn profiles and public company data
 * - memory_read/write: deduplication across sessions
 * - Model: Sonnet — research + structured extraction task
 * - Accepts company names or LeadProfile[] for multi-agent pipelines
 * - Assembles per-company summaries and coverage quality assessments
 */
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { BaseAgent } from "../_base/agent.js";
import type { ToolHandler, AgentRunOptions } from "../_base/types.js";

import { webSearchTool, memoryReadTool, memoryWriteTool } from "../../tools/index.js";
import { logger } from "../../config/logger.js";
import { Models, ModelConfig } from "../../config/models.js";

import { validateEnrichedContact, saveContactInputSchema } from "./schemas.js";
import type {
  EnrichedContact,
  EnrichedCompany,
  EnrichmentResult,
  EnrichmentOptions,
  EnrichmentRequest,
  ContactSeniority,
} from "./types.js";
import type { LeadProfile } from "../futurecom-researcher/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Seniority ordering for minSeniority filter ───────────────────────────────

const SENIORITY_RANK: Record<ContactSeniority, number> = {
  "c-level":  4,
  "director": 3,
  "manager":  2,
  "analyst":  1,
};

// ─── save_contact tool ────────────────────────────────────────────────────────

function createSaveContactTool(contacts: EnrichedContact[]): ToolHandler {
  return {
    name: "save_contact",
    schema: {
      name: "save_contact",
      description:
        "Save an enriched contact (decision maker) for a target company. Call once per person found.",
      input_schema: saveContactInputSchema,
    },
    execute: async (input) => {
      const validation = validateEnrichedContact(input);

      if (!validation.success) {
        const issues = validation.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        logger.warn("[lead-enrichment-agent] invalid contact rejected", { issues });
        return { success: false, error: `Validation failed: ${issues}` };
      }

      const contact: EnrichedContact = {
        ...validation.data,
        enrichedAt: new Date().toISOString(),
      };

      // Deduplicate: skip if same name+company already stored
      const isDuplicate = contacts.some(
        (c) =>
          c.company.toLowerCase() === contact.company.toLowerCase() &&
          c.name.toLowerCase() === contact.name.toLowerCase()
      );

      if (isDuplicate) {
        logger.debug("[lead-enrichment-agent] duplicate contact skipped", {
          company: contact.company,
          name: contact.name,
        });
        return { success: false, error: "Duplicate contact — same name+company already saved" };
      }

      contacts.push(contact);
      logger.info("[lead-enrichment-agent] contact saved", {
        company: contact.company,
        name: contact.name,
        role: contact.role,
        priority: contact.priority,
        score: contact.priorityScore,
      });

      return { success: true, name: contact.name, company: contact.company };
    },
  };
}

// ─── Agent ────────────────────────────────────────────────────────────────────

export class LeadEnrichmentAgent extends BaseAgent {
  private contacts: EnrichedContact[] = [];

  constructor(systemPrompt: string) {
    super({
      name: "lead-enrichment-agent",
      description: "Enriches company leads with decision maker profiles for VRASHOWS outreach",
      systemPrompt,
      model: Models.default,
      maxTokens: ModelConfig.maxTokens.extended,
      temperature: ModelConfig.temperature.deterministic,
      maxIterations: 40,
      memoryEnabled: true,
      memorySaveEnabled: false,
    });
  }

  static async create(): Promise<LeadEnrichmentAgent> {
    const promptPath = join(__dirname, "../../prompts/agents/lead-enrichment-agent.md");
    const systemPrompt = await readFile(promptPath, "utf8");
    const agent = new LeadEnrichmentAgent(systemPrompt);
    agent.registerTool(webSearchTool);
    agent.registerTool(memoryReadTool);
    agent.registerTool(memoryWriteTool);
    agent.registerTool(createSaveContactTool(agent.contacts));
    return agent;
  }

  // ─── enrich: primary entry point ──────────────────────────────────────────

  /**
   * Enrich a list of companies with decision maker contacts.
   * Accepts either raw company names or LeadProfile objects.
   */
  async enrich(
    request: EnrichmentRequest,
    runOptions: AgentRunOptions = {}
  ): Promise<EnrichmentResult> {
    const {
      companies,
      leadContext = [],
      options = {},
    } = request;

    const {
      areas,
      minSeniority = "manager",
      maxContactsPerCompany = 5,
      event = "Futurecom 2026",
    } = options;

    this.contacts = [];
    const sessionStartedAt = new Date().toISOString();

    logger.info("[lead-enrichment-agent] starting enrichment session", {
      companies: companies.length,
      minSeniority,
      maxContactsPerCompany,
      event,
    });

    const leadContextBlock = this.buildLeadContextBlock(companies, leadContext);
    const prompt = this.buildPrompt(companies, {
      areas,
      minSeniority,
      maxContactsPerCompany,
      event,
      leadContextBlock,
    });

    const result = await this.run(prompt, runOptions);

    // Apply post-run filters
    const minRank = SENIORITY_RANK[minSeniority];
    const filtered = this.contacts.filter(
      (c) => SENIORITY_RANK[c.seniority] >= minRank
    );

    // Assemble per-company summaries
    const companyMap = this.buildCompanyMap(companies, filtered, maxContactsPerCompany);

    const gaps = companies.filter(
      (co) => !companyMap.find((c) => c.company.toLowerCase() === co.toLowerCase() && c.totalContacts > 0)
    );

    const sessionCompletedAt = new Date().toISOString();

    logger.info("[lead-enrichment-agent] session complete", {
      totalContacts: filtered.length,
      companies: companyMap.length,
      gaps: gaps.length,
    });

    return {
      companiesProcessed: companies.length,
      contacts: filtered,
      companies: companyMap,
      gaps,
      researchSummary: result.output,
      sessionStartedAt,
      sessionCompletedAt,
    };
  }

  // ─── enrichFromLeads: multi-agent convenience ──────────────────────────────

  /**
   * Enrich from LeadProfile[] — used in multi-agent pipelines where
   * futurecom-researcher output feeds directly into enrichment.
   */
  async enrichFromLeads(
    leads: LeadProfile[],
    options?: EnrichmentOptions,
    runOptions?: AgentRunOptions
  ): Promise<EnrichmentResult> {
    return this.enrich(
      {
        companies: leads.map((l) => l.company),
        leadContext: leads,
        options,
      },
      runOptions
    );
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private buildLeadContextBlock(companies: string[], leads: LeadProfile[]): string {
    if (leads.length === 0) return "";

    const relevant = leads.filter((l) =>
      companies.some((c) => c.toLowerCase() === l.company.toLowerCase())
    );

    if (relevant.length === 0) return "";

    const lines = relevant.map(
      (l) =>
        `- ${l.company}: segment=${l.segment}, booth=${l.boothComplexity}, budget=${l.budgetPotential}, score=${l.initialScore}`
    );

    return `\nAdditional lead context:\n${lines.join("\n")}\n`;
  }

  private buildCompanyMap(
    companies: string[],
    contacts: EnrichedContact[],
    maxPerCompany: number
  ): EnrichedCompany[] {
    return companies.map((company) => {
      const companyContacts = contacts
        .filter((c) => c.company.toLowerCase() === company.toLowerCase())
        .sort((a, b) => b.priorityScore - a.priorityScore)
        .slice(0, maxPerCompany);

      const total = companyContacts.length;
      const primaryContact = companyContacts[0] ?? null;

      const coverageQuality =
        total >= 3 ? "strong" :
        total === 2 ? "partial" :
        total === 1 ? "weak" :
        "none";

      return {
        company,
        contacts: companyContacts,
        primaryContact,
        totalContacts: total,
        coverageQuality,
        enrichedAt: new Date().toISOString(),
      };
    });
  }

  private buildPrompt(
    companies: string[],
    opts: {
      areas?: string[];
      minSeniority: string;
      maxContactsPerCompany: number;
      event: string;
      leadContextBlock: string;
    }
  ): string {
    const areaFocus = opts.areas?.length
      ? `Focus areas: ${opts.areas.join(", ")}.`
      : "Focus areas: marketing, events, brand, customer-experience, communications, sponsorship.";

    return `
Enrich the following companies with decision maker contact intelligence for VRASHOWS.

Target event: ${opts.event}
Minimum seniority: ${opts.minSeniority} (include manager level and above)
Max contacts per company: ${opts.maxContactsPerCompany}
${areaFocus}
${opts.leadContextBlock}

Target companies:
${companies.map((c, i) => `${i + 1}. ${c}`).join("\n")}

For each company:
1. Search for decision makers in marketing, events, brand, CX, and communications
2. Find their full name, role, and LinkedIn profile
3. Infer their corporate email using the company's domain pattern
4. Assess their priority and decision-making authority relative to event operations
5. Call save_contact for each valid contact found

Search strategy per company:
- "[Company] diretor marketing linkedin"
- "[Company] gerente eventos corporativos"
- "[Company] head of events OR brand OR marketing"
- "[Company] CMO OR VP marketing"
- "[Company] patrocínio Futurecom"

Priority criteria:
- High: Director/VP/C-level in marketing, events, brand, CX — confirmed budget authority
- Medium: Managers in same areas
- Low: Procurement, adjacent roles

Process all ${companies.length} companies before responding.
`.trim();
  }
}
