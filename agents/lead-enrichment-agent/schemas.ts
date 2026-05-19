/**
 * Zod schemas and JSON Schema definitions for the Lead Enrichment Agent.
 *
 * The save_contact tool forces Claude to emit one structured contact
 * record per person found — same pattern as save_lead and save_outreach.
 */
import { z } from "zod";

// ─── Enum schemas ─────────────────────────────────────────────────────────────

export const ContactAreaSchema = z.enum([
  "marketing",
  "events",
  "brand",
  "customer-experience",
  "communications",
  "sponsorship",
  "procurement",
  "c-suite",
  "other",
]);

export const ContactSenioritySchema = z.enum([
  "c-level",
  "director",
  "manager",
  "analyst",
]);

export const ContactPrioritySchema = z.enum(["high", "medium", "low"]);

export const EmailConfidenceSchema = z.enum(["high", "medium", "low"]);

// ─── Contact schema ───────────────────────────────────────────────────────────

const GuessedEmailSchema = z.object({
  email:      z.string(),
  pattern:    z.string(),
  confidence: EmailConfidenceSchema,
});

export const EnrichedContactSchema = z.object({
  company: z.string().min(1),
  name: z.string().min(2).describe("Full name — first and last name required"),
  role: z.string().min(2).describe("Job title as found in public sources"),
  area: ContactAreaSchema,
  seniority: ContactSenioritySchema,
  linkedin: z.string().describe("LinkedIn profile URL or 'unknown'"),
  possibleEmail: z.string().describe("Possible corporate email or 'unknown'"),
  emailInferred: z.boolean(),
  emailConfidence: EmailConfidenceSchema,
  guessedEmails: z.array(GuessedEmailSchema).optional(),
  priority: ContactPrioritySchema,
  priorityScore: z.number().int().min(0).max(100),
  strategicNotes: z.string().min(20).describe("Strategic notes for VRASHOWS sales team (1-2 sentences)"),
  sources: z.array(z.string()).describe("Public sources where this contact was found"),
});

// ─── JSON Schema for save_contact tool (passed to Claude) ────────────────────

export const saveContactInputSchema = {
  type: "object" as const,
  properties: {
    company: {
      type: "string",
      description: "Target company name — must match the company being enriched",
    },
    name: {
      type: "string",
      description: "Full name (first + last). Only save if both are known.",
    },
    role: {
      type: "string",
      description: "Job title exactly as found in public sources",
    },
    area: {
      type: "string",
      enum: ["marketing", "events", "brand", "customer-experience", "communications", "sponsorship", "procurement", "c-suite", "other"],
      description: "Functional area most relevant to VRASHOWS services",
    },
    seniority: {
      type: "string",
      enum: ["c-level", "director", "manager", "analyst"],
      description: "Seniority classification: c-level (CMO/VP/C-suite), director (Head of/Director), manager (Manager/Coordinator), analyst (Analyst/Specialist)",
    },
    linkedin: {
      type: "string",
      description: "LinkedIn profile URL if found, otherwise 'unknown'",
    },
    possibleEmail: {
      type: "string",
      description: "Inferred or confirmed corporate email. Use pattern: firstname.lastname@company.com.br. Set to 'unknown' if domain not determinable.",
    },
    emailInferred: {
      type: "boolean",
      description: "true if email was inferred from name+domain pattern; false only if confirmed from a public source",
    },
    emailConfidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "high: pattern confirmed or company format known. medium: inferred from domain+name. low: domain uncertain.",
    },
    guessedEmails: {
      type: "array",
      description: "All email candidates from resolve_email_pattern tool, ordered by confidence. Pass the full array returned by the tool.",
      items: {
        type: "object",
        properties: {
          email:      { type: "string" },
          pattern:    { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["email", "pattern", "confidence"],
      },
    },
    priority: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "Outreach priority: high (director+, confirmed events budget authority), medium (manager level, events-adjacent), low (procurement, unclear role)",
    },
    priorityScore: {
      type: "number",
      description: "Numeric priority 0-100. high=80-100, medium=50-79, low=20-49",
    },
    strategicNotes: {
      type: "string",
      description: "1-2 sentences: their role in event decisions + any public signals (conference speaker, article, LinkedIn post, sponsorship involvement)",
    },
    sources: {
      type: "array",
      items: { type: "string" },
      description: "URLs or descriptions of public sources where this contact was found",
    },
  },
  required: [
    "company",
    "name",
    "role",
    "area",
    "seniority",
    "linkedin",
    "possibleEmail",
    "emailInferred",
    "emailConfidence",
    "priority",
    "priorityScore",
    "strategicNotes",
    "sources",
  ],
};

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateEnrichedContact(raw: unknown) {
  return EnrichedContactSchema.safeParse(raw);
}
