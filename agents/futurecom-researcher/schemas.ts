/**
 * Zod schemas for the Futurecom Researcher agent.
 *
 * Used both for runtime validation of structured tool outputs
 * and as the source of truth for JSON Schema definitions passed
 * to Claude as tool input_schema.
 */
import { z } from "zod";

// ─── Enum schemas ─────────────────────────────────────────────────────────────

export const BudgetPotentialSchema = z.enum(["low", "medium", "high", "enterprise"]);

export const EventRelevanceSchema = z.enum(["low", "medium", "high", "strategic"]);

export const BoothComplexitySchema = z.enum(["standard", "custom", "large", "mega"]);

export const LeadSegmentSchema = z.enum([
  "telecom",
  "cloud",
  "saas",
  "ai",
  "cybersecurity",
  "enterprise-software",
  "connectivity",
  "infrastructure",
  "iot",
  "fintech",
  "other",
]);

// ─── Lead schema ──────────────────────────────────────────────────────────────

export const LeadProfileSchema = z.object({
  company: z.string().min(1).describe("Company legal/commercial name"),
  segment: LeadSegmentSchema.describe("Primary industry segment"),
  website: z.string().describe("Company website URL or 'unknown'"),
  linkedin: z.string().describe("LinkedIn company page URL or 'unknown'"),
  budgetPotential: BudgetPotentialSchema.describe("Estimated annual event investment capacity"),
  eventRelevance: EventRelevanceSchema.describe("How central events are to this company's GTM"),
  boothComplexity: BoothComplexitySchema.describe("Estimated booth operational complexity at Futurecom"),
  strategicNotes: z.string().min(20).describe("Strategic notes for VRASHOWS sales team (2-4 sentences)"),
  initialScore: z.number().int().min(0).max(100).describe("Lead quality score 0-100"),
  sources: z.array(z.string()).describe("Evidence sources (URLs or descriptions) supporting this lead"),
});

// ─── JSON Schema for tool input_schema (passed to Claude) ────────────────────

export const saveleadInputSchema = {
  type: "object" as const,
  properties: {
    company: {
      type: "string",
      description: "Company legal/commercial name",
    },
    segment: {
      type: "string",
      enum: ["telecom", "cloud", "saas", "ai", "cybersecurity", "enterprise-software", "connectivity", "infrastructure", "iot", "fintech", "other"],
      description: "Primary industry segment",
    },
    website: {
      type: "string",
      description: "Company website URL, or 'unknown' if not found",
    },
    linkedin: {
      type: "string",
      description: "LinkedIn company page URL, or 'unknown' if not found",
    },
    budgetPotential: {
      type: "string",
      enum: ["low", "medium", "high", "enterprise"],
      description: "Estimated annual event investment capacity: low (<R$100k), medium (R$100k-500k), high (R$500k-2M), enterprise (>R$2M)",
    },
    eventRelevance: {
      type: "string",
      enum: ["low", "medium", "high", "strategic"],
      description: "How central events are to this company's GTM strategy",
    },
    boothComplexity: {
      type: "string",
      enum: ["standard", "custom", "large", "mega"],
      description: "Estimated booth operational complexity: standard (9-18m²), custom (20-50m²), large (50-100m²), mega (100m²+)",
    },
    strategicNotes: {
      type: "string",
      description: "Strategic notes for VRASHOWS sales team — highlight operational pain points and VRASHOWS value proposition (2-4 sentences)",
    },
    initialScore: {
      type: "number",
      description: "Lead quality score 0-100. Score higher for: enterprise presence, large booths, event sponsorship, premium CX focus",
    },
    sources: {
      type: "array",
      items: { type: "string" },
      description: "Evidence sources (URLs or text descriptions) used to qualify this lead",
    },
  },
  required: [
    "company",
    "segment",
    "website",
    "linkedin",
    "budgetPotential",
    "eventRelevance",
    "boothComplexity",
    "strategicNotes",
    "initialScore",
    "sources",
  ],
};

// ─── Validation helpers ───────────────────────────────────────────────────────

export function validateLeadProfile(raw: unknown) {
  return LeadProfileSchema.safeParse(raw);
}
