/**
 * Types for the Lead Validation Pipeline.
 *
 * Extends EnrichedContact with strategic scoring, classification,
 * and outreach recommendations for the VRASHOWS enterprise outbound system.
 */

// ─── Classification ───────────────────────────────────────────────────────────

export type LeadStatus =
  | "HOT"          // High relevance + low bounce risk → send immediately
  | "WARM"         // Good relevance + acceptable risk → queue for next batch
  | "LOW_PRIORITY" // Low relevance or higher risk → deprioritize
  | "INVALID";     // No decision-making power OR high bounce risk → skip

// ─── Scores ───────────────────────────────────────────────────────────────────

export type BounceRisk = "low" | "medium" | "high";

export type StrategicFit = "excellent" | "strong" | "moderate" | "weak";

export type RecommendedTemplate =
  | "executive-intro"   // C-level: ultra-concise, peer-to-peer
  | "cold-outreach"     // Director/Manager: full hub positioning
  | "linkedin-message"; // Technical/Secondary: shorter version

// ─── Validated Lead ───────────────────────────────────────────────────────────

export interface GuessedEmail {
  email: string;
  pattern: string;
  confidence: "high" | "medium" | "low";
}

export interface ValidatedLead {
  // ── Identity
  company: string;
  contactName: string;
  role: string;
  linkedin: string;
  area: string;
  seniority: string;

  // ── Email intelligence
  guessedEmails: GuessedEmail[];
  primaryEmail: string;
  confidence: "high" | "medium" | "low";
  bounceRisk: BounceRisk;

  // ── Scoring
  relevanceScore: number;     // 0-100: decision power for events/marketing/brand
  strategicFitScore: number;  // 0-100: company fit with VRASHOWS profile
  outreachPriority: number;   // 0-100: combined priority for sending

  // ── Strategic analysis
  strategicFit: StrategicFit;
  rationale: string;

  // ── Outreach recommendations
  recommendedTemplate: RecommendedTemplate;
  recommendedApproach: string;
  recommendedCTA: string;
  useCaseABRINT: boolean;
  personalizationLevel: "high" | "medium" | "standard";

  // ── Classification
  status: LeadStatus;

  // ── Metadata
  campaignId: string;
  targetEvent: string;
  validatedAt: string;
  originalPriorityScore?: number;
}

// ─── Pipeline result ──────────────────────────────────────────────────────────

export interface ValidationResult {
  campaignId: string;
  targetEvent: string;
  totalLeads: number;
  hot: number;
  warm: number;
  lowPriority: number;
  invalid: number;
  leads: ValidatedLead[];
  validatedAt: string;
}

// ─── Input format (matches aws-leads.json schema) ─────────────────────────────

export interface RawLead {
  company: string;
  contactName: string;
  role: string;
  area: string;
  seniority: string;
  linkedin: string;
  guessedEmails: GuessedEmail[];
  confidence: "high" | "medium" | "low";
  priority: string;
  priorityScore: number;
  outreachStatus: string;
  rationale: string;
  notes: string;
}

export interface RawLeadFile {
  campaign: string;
  targetEvent: string;
  enrichedAt: string;
  leads: RawLead[];
}
