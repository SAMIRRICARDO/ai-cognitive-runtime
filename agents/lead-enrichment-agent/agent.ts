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
import { isCheapMode } from "../../config/env.js";
import { Models, ModelConfig, getMaxTokens, getMaxIterations } from "../../config/models.js";

import { validateEnrichedContact, saveContactInputSchema } from "./schemas.js";
import { emailPatternResolver } from "./email-resolver.js";
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

// ─── resolve_email_pattern tool ───────────────────────────────────────────────

function createEmailResolverTool(): ToolHandler {
  return {
    name: "resolve_email_pattern",
    schema: {
      name: "resolve_email_pattern",
      description:
        "Infer probable corporate email addresses for a contact using name normalization and a corporate domain registry. Returns ranked email variants with confidence scores. Call this BEFORE save_contact for every contact found.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Full name of the contact (first and last name)",
          },
          company: {
            type: "string",
            description: "Company name (used for domain registry lookup)",
          },
          website: {
            type: "string",
            description: "Company website URL if known (e.g. aws.amazon.com, vivo.com.br) — improves domain accuracy",
          },
          domain: {
            type: "string",
            description: "Known corporate email domain (e.g. amazon.com) — overrides all other detection",
          },
        },
        required: ["name", "company"],
      },
    },
    execute: async (raw) => {
      const input = raw as { name: string; company: string; website?: string; domain?: string };
      const result = emailPatternResolver.resolve({
        name: input.name,
        company: input.company,
        website: input.website,
        domain: input.domain,
      });
      logger.debug("[lead-enrichment-agent] email pattern resolved", {
        name: input.name,
        company: input.company,
        domain: result.domain,
        domainSource: result.domainSource,
        confidence: result.confidence,
        topEmail: result.guessedEmails[0]?.email,
      });
      return result;
    },
  };
}

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
      model: isCheapMode ? Models.fast : Models.default,
      maxTokens: getMaxTokens(isCheapMode ? ModelConfig.maxTokens.cheap : ModelConfig.maxTokens.extended),
      temperature: ModelConfig.temperature.deterministic,
      maxIterations: getMaxIterations(isCheapMode ? 2 : 40),
      memoryEnabled: !isCheapMode,
      memorySaveEnabled: false,
    });
  }

  static async create(): Promise<LeadEnrichmentAgent> {
    const promptPath = join(__dirname, "../../prompts/agents/lead-enrichment-agent.md");
    const systemPrompt = await readFile(promptPath, "utf8");
    const agent = new LeadEnrichmentAgent(systemPrompt);
    if (!isCheapMode) {
      agent.registerTool(webSearchTool);
      agent.registerTool(memoryReadTool);
      agent.registerTool(memoryWriteTool);
    }
    agent.registerTool(createEmailResolverTool());
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
    const limitedCompanies = companies.slice(0, 25);
    const contactLimit = isCheapMode ? 1 : maxContactsPerCompany;

    this.contacts = [];
    const sessionStartedAt = new Date().toISOString();

    logger.info("[lead-enrichment-agent] starting enrichment session", {
      companies: limitedCompanies.length,
      minSeniority,
      maxContactsPerCompany: contactLimit,
      event,
    });

    const leadContextBlock = this.buildLeadContextBlock(limitedCompanies, leadContext);
    const prompt = this.buildPrompt(limitedCompanies, {
      areas,
      minSeniority,
      maxContactsPerCompany: contactLimit,
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
    const companyMap = this.buildCompanyMap(limitedCompanies, filtered, contactLimit);

    const gaps = limitedCompanies.filter(
      (co) => !companyMap.find((c) => c.company.toLowerCase() === co.toLowerCase() && c.totalContacts > 0)
    );

    const sessionCompletedAt = new Date().toISOString();

    logger.info("[lead-enrichment-agent] session complete", {
      totalContacts: filtered.length,
      companies: companyMap.length,
      gaps: gaps.length,
    });

    return {
      companiesProcessed: limitedCompanies.length,
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

    if (isCheapMode) {
      return `
JSON/tool output only. No reasoning.
Event: ${opts.event}
Max contacts/company: ${opts.maxContactsPerCompany}
Areas: ${opts.areas?.join(", ") ?? "marketing, events, brand"}
${opts.leadContextBlock}
Companies:
${companies.map((c, i) => `${i + 1}. ${c}`).join("\n")}
For each company: pick one likely marketing/events decision maker, resolve email, call save_contact.
Final response: {"ok":true}
`.trim();
    }

    return `
Enrich companies with decision maker contact intelligence for VRASHOWS.
Target event: ${opts.event}
Minimum seniority: ${opts.minSeniority}
Max contacts per company: ${opts.maxContactsPerCompany}
${areaFocus}
${opts.leadContextBlock}
Target companies:
${companies.map((c, i) => `${i + 1}. ${c}`).join("\n")}
Call resolve_email_pattern before save_contact. Process all ${companies.length} companies.
`.trim();
  }
}
