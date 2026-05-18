/**
 * Types for the Futurecom Researcher agent.
 *
 * Models the output of enterprise lead intelligence for VRASHOWS,
 * targeting companies exhibiting at Futurecom 2026.
 */

export type BudgetPotential = "low" | "medium" | "high" | "enterprise";

export type EventRelevance =
  | "low"        // occasional participation, no brand emphasis
  | "medium"     // regular participation, moderate booth investment
  | "high"       // flagship events, large booths, heavy sponsorship
  | "strategic"; // anchor sponsors, naming rights, full ecosystem presence

export type BoothComplexity =
  | "standard"   // 9–18m² shell scheme
  | "custom"     // 20–50m² custom build
  | "large"      // 50–100m² complex installation
  | "mega";      // 100m²+ multi-story / experiential flagship

export type LeadSegment =
  | "telecom"
  | "cloud"
  | "saas"
  | "ai"
  | "cybersecurity"
  | "enterprise-software"
  | "connectivity"
  | "infrastructure"
  | "iot"
  | "fintech"
  | "other";

// ─── Lead model ───────────────────────────────────────────────────────────────

export interface LeadProfile {
  /** Company legal/commercial name */
  company: string;

  /** Primary industry segment */
  segment: LeadSegment;

  /** Company website URL */
  website: string;

  /** LinkedIn company page URL */
  linkedin: string;

  /** Estimated annual event investment capacity */
  budgetPotential: BudgetPotential;

  /** How central events are to this company's go-to-market */
  eventRelevance: EventRelevance;

  /** Estimated booth size / operational complexity at Futurecom */
  boothComplexity: BoothComplexity;

  /** Strategic notes for VRASHOWS sales team */
  strategicNotes: string;

  /** Score 0–100: higher = stronger VRASHOWS fit */
  initialScore: number;

  /** ISO timestamp when the lead was generated */
  generatedAt: string;

  /** Evidence sources (URLs or descriptions) used for this lead */
  sources: string[];
}

// ─── Research session ─────────────────────────────────────────────────────────

export interface FuturecomResearchResult {
  /** Query/topic that triggered this research session */
  query: string;

  /** All leads identified in this session */
  leads: LeadProfile[];

  /** Summary of research performed */
  researchSummary: string;

  /** Total leads found */
  totalLeads: number;

  /** High-priority leads (score >= 70) */
  highPriorityCount: number;

  /** ISO timestamp of session start */
  sessionStartedAt: string;

  /** ISO timestamp of session end */
  sessionCompletedAt: string;
}

// ─── Run options ─────────────────────────────────────────────────────────────

export interface FuturecomResearchOptions {
  /** Target event (default: "Futurecom 2026") */
  event?: string;

  /** Min score threshold to include a lead (default: 30) */
  minScore?: number;

  /** Max leads to return per session (default: 20) */
  maxLeads?: number;

  /** Focus segments to prioritise */
  segments?: LeadSegment[];
}
