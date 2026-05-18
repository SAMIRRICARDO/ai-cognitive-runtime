/**
 * Zod schemas and JSON Schema definitions for the Outreach Agent.
 *
 * The save_outreach tool forces Claude to emit structured outreach
 * packages per company — same pattern as save_lead in futurecom-researcher.
 */
import { z } from "zod";

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

export const ColdEmailSchema = z.object({
  subject: z.string().max(80).describe("Email subject line — max 8 words, non-promotional"),
  body: z.string().min(100).max(1200).describe("Full email body — 120 to 180 words, consultive tone"),
  cta: z.string().min(20).describe("Standalone call-to-action sentence"),
});

export const LinkedInMessageSchema = z.object({
  body: z.string().min(40).max(600).describe("LinkedIn message body — 60 to 90 words"),
  cta: z.string().min(20).describe("Standalone call-to-action sentence"),
  connectionNote: z.string().max(300).describe("Short cold connect note (≤300 chars)"),
});

// ─── Full package schema ──────────────────────────────────────────────────────

export const OutreachPackageSchema = z.object({
  company: z.string().min(1),
  leadScore: z.number().int().min(0).max(100),
  coldEmail: ColdEmailSchema,
  linkedinMessage: LinkedInMessageSchema,
  meetingCta: z.string().min(20).describe("Recommended meeting CTA for this specific lead"),
  strategicPositioning: z.string().min(40).describe("How to frame the first conversation — angle and narrative"),
  personalizationNotes: z.string().min(20).describe("What makes this outreach specific to this company"),
});

// ─── JSON Schema for save_outreach tool input_schema ─────────────────────────

export const saveOutreachInputSchema = {
  type: "object" as const,
  properties: {
    company: {
      type: "string",
      description: "Company name — must match the lead being processed",
    },
    leadScore: {
      type: "number",
      description: "Lead score from futurecom-researcher (0-100)",
    },
    coldEmail: {
      type: "object",
      description: "Generated cold email",
      properties: {
        subject: {
          type: "string",
          description: "Subject line — max 8 words, non-promotional, specific to company context",
        },
        body: {
          type: "string",
          description: "Email body — 120-180 words. Structure: observation → operational challenge → VRASHOWS value → optional case ref → CTA",
        },
        cta: {
          type: "string",
          description: "Standalone CTA sentence — extracted from body for A/B testing",
        },
      },
      required: ["subject", "body", "cta"],
    },
    linkedinMessage: {
      type: "object",
      description: "Generated LinkedIn message",
      properties: {
        body: {
          type: "string",
          description: "Message body — 60-90 words, direct but consultive",
        },
        cta: {
          type: "string",
          description: "Standalone CTA sentence",
        },
        connectionNote: {
          type: "string",
          description: "Cold connect request note — max 300 chars, no pitch, just context",
        },
      },
      required: ["body", "cta", "connectionNote"],
    },
    meetingCta: {
      type: "string",
      description: "The single most appropriate meeting CTA for this lead — specific, low-friction, time-bounded",
    },
    strategicPositioning: {
      type: "string",
      description: "2-3 sentences on how VRASHOWS should frame the first conversation: the angle to open with and the operational narrative to develop",
    },
    personalizationNotes: {
      type: "string",
      description: "1-2 sentences on what makes this outreach unique to this company — what signals from their profile drove the personalization choices",
    },
  },
  required: [
    "company",
    "leadScore",
    "coldEmail",
    "linkedinMessage",
    "meetingCta",
    "strategicPositioning",
    "personalizationNotes",
  ],
};

// ─── Validation helpers ───────────────────────────────────────────────────────

export function validateOutreachPackage(raw: unknown) {
  return OutreachPackageSchema.safeParse(raw);
}
