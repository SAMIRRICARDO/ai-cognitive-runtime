/**
 * Types for the Lead Enrichment Agent.
 *
 * Models enriched contact intelligence for enterprise decision makers
 * identified inside VRASHOWS target companies.
 *
 * Designed to feed downstream agents (outreach-agent, lead-scorer)
 * and CRM export pipelines.
 */
import type { LeadProfile } from "../futurecom-researcher/types.js";

// ─── Enums ────────────────────────────────────────────────────────────────────

/** Functional area of the contact within the company */
export type ContactArea =
  | "marketing"
  | "events"
  | "brand"
  | "customer-experience"
  | "communications"
  | "sponsorship"
  | "procurement"
  | "c-suite"
  | "other";

/** Seniority + decision-making authority relative to VRASHOWS services */
export type ContactSeniority =
  | "c-level"    // CMO, CCO, VP, C-suite
  | "director"   // Director, Head of
  | "manager"    // Manager, Coordinator, Senior
  | "analyst";   // Analyst, Specialist, Junior

/** Overall contact priority for VRASHOWS outreach */
export type ContactPriority = "high" | "medium" | "low";

/** Confidence level for inferred email addresses */
export type EmailConfidence = "high" | "medium" | "low";

// ─── Email pattern resolution ──────────────────────────────────────────────────

/** A single email candidate with pattern label and confidence */
export interface GuessedEmail {
  /** The inferred email address */
  email: string;
  /** Pattern used to generate it (e.g. "firstname.lastname") */
  pattern: string;
  /** Confidence based on domain knowledge and pattern prevalence */
  confidence: EmailConfidence;
}

/** Full result from EmailPatternResolver.resolve() */
export interface EmailPatternResult {
  /** Resolved corporate email domain */
  domain: string;
  /** How the domain was determined */
  domainSource: "known" | "website" | "inferred";
  /** Primary pattern detected for this company */
  pattern: string;
  /** Ordered email candidates, highest confidence first */
  guessedEmails: GuessedEmail[];
  /** Aggregate confidence for the top candidate */
  confidence: EmailConfidence;
  /** Human-readable explanation of the inference */
  reasoning: string;
}

// ─── Contact ──────────────────────────────────────────────────────────────────

export interface EnrichedContact {
  /** Target company name */
  company: string;

  /** Full name (first + last) */
  name: string;

  /** Role/job title as found in public sources */
  role: string;

  /** Functional area classification */
  area: ContactArea;

  /** Seniority level */
  seniority: ContactSeniority;

  /** LinkedIn profile URL, or "unknown" */
  linkedin: string;

  /** Possible corporate email address */
  possibleEmail: string;

  /** Whether the email was inferred (not confirmed from a public source) */
  emailInferred: boolean;

  /** Confidence level for the email (relevant only when emailInferred is true) */
  emailConfidence: EmailConfidence;

  /** All inferred email candidates ranked by confidence (from EmailPatternResolver) */
  guessedEmails?: GuessedEmail[];

  /** Outreach priority for VRASHOWS sales team */
  priority: ContactPriority;

  /** Priority score 0–100 (mirrors priority as numeric for sorting) */
  priorityScore: number;

  /** Strategic notes for VRASHOWS sales team */
  strategicNotes: string;

  /** Public sources where this contact was found */
  sources: string[];

  /** ISO timestamp of enrichment */
  enrichedAt: string;
}

// ─── Company enrichment summary ───────────────────────────────────────────────

export interface EnrichedCompany {
  /** Company name */
  company: string;

  /** All contacts found at this company, sorted by priorityScore desc */
  contacts: EnrichedContact[];

  /** Primary decision maker (highest priorityScore contact) */
  primaryContact: EnrichedContact | null;

  /** Total contacts found */
  totalContacts: number;

  /** Coverage quality assessment */
  coverageQuality: "strong" | "partial" | "weak" | "none";

  /** ISO timestamp of enrichment */
  enrichedAt: string;
}

// ─── Session result ───────────────────────────────────────────────────────────

export interface EnrichmentResult {
  /** Companies processed in this session */
  companiesProcessed: number;

  /** All enriched contacts from the session */
  contacts: EnrichedContact[];

  /** Per-company enrichment summaries */
  companies: EnrichedCompany[];

  /** Companies with no contacts found */
  gaps: string[];

  /** Agent research summary */
  researchSummary: string;

  /** ISO timestamp of session start */
  sessionStartedAt: string;

  /** ISO timestamp of session end */
  sessionCompletedAt: string;
}

// ─── Input options ────────────────────────────────────────────────────────────

export interface EnrichmentOptions {
  /** Target areas to focus on (default: all relevant areas) */
  areas?: ContactArea[];

  /** Minimum seniority to include (default: manager) */
  minSeniority?: ContactSeniority;

  /** Max contacts per company (default: 5) */
  maxContactsPerCompany?: number;

  /** Target event for context (default: "Futurecom 2026") */
  event?: string;
}

// ─── Multi-agent input ────────────────────────────────────────────────────────

export interface EnrichmentRequest {
  /** Company names to enrich — can come from CLI or LeadProfile[] */
  companies: string[];

  /** Optional lead profiles for additional context */
  leadContext?: LeadProfile[];

  options?: EnrichmentOptions;
}
