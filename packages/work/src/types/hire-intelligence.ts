// packages/work/src/types/hire-intelligence.ts
// Hire Intelligence Engine (HIE) — core types for Career OS v2

import type { ApplyAction } from './index.js';

// ── Professional Twins ────────────────────────────────────────────────────────

export type TwinId =
  | 'twin_ai_engineer'
  | 'twin_backend'
  | 'twin_architect'
  | 'twin_techlead';

export interface ProfessionalTwin {
  id: TwinId;
  label: string;
  headline: string;
  about: string;
  primaryStack: string[];
  skills: string[];
  atsKeywords: string[];
  targetRoles: string[];
  targetSeniority: 'senior' | 'lead' | 'architect' | 'director';
  targetSalary: number;
  currency: 'BRL' | 'USD';
  resumePath?: string;
  resumeMd?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Hire Score ────────────────────────────────────────────────────────────────

export type CompetitionLevel = 'low' | 'medium' | 'high' | 'very_high';

export interface HireScoreDimensions {
  technicalFit: number;       // 0–100: stack + skills match
  salaryFit: number;          // 0–100: salary range compatibility
  seniorityFit: number;       // 0–100: experience level match
  locationFit: number;        // 0–100: remote/hybrid/onsite fit
  atsProbability: number;     // 0–100: keyword coverage vs JD
  historicalScore: number;    // 0–100: pattern-based prediction from LearningEngine
}

export interface MarketContext {
  competitionLevel: CompetitionLevel;
  publicationAgeDays: number;
  applicantCount?: number;
  platformEaseScore: number;  // 0–100: how easy is it to apply on this platform
}

export interface HireScore {
  jobId: string;
  twinId: TwinId;

  dimensions: HireScoreDimensions;
  marketContext: MarketContext;

  interviewProbability: number;  // 0–100 — primary KPI
  hireScore: number;             // 0–100 — composite gate score
  action: ApplyAction;           // APPLY if interviewProbability >= HIRE_THRESHOLD
  reasoning: string;
  keyStrengths: string[];
  keyWeaknesses: string[];
  atsKeywordsFound: string[];
  atsKeywordsMissing: string[];

  scoredAt: string;
  expiresAt: string;
}

// ── Interview Outcomes ────────────────────────────────────────────────────────

export type InterviewOutcomeType =
  | 'interview'
  | 'rejection'
  | 'no_response'
  | 'offer'
  | 'hired'
  | 'ghosted';  // applied >30d ago, no response

export interface InterviewOutcome {
  id: string;
  jobId: string;
  twinId: TwinId;
  cvVersion?: string;

  // Snapshot of HIE inputs at apply time
  hireScoreAtApply: number;
  interviewProbabilityAtApply: number;
  technicalFitAtApply: number;
  atsProbabilityAtApply: number;

  outcome: InterviewOutcomeType;
  outcomeRecordedAt?: string;
  responseTimeDays?: number;

  // Job metadata (for learning pattern extraction)
  company: string;
  jobTitle: string;
  platform: string;
  stackTags: string[];         // extracted tech stack tags from JD

  createdAt: string;
}

// ── Learning Patterns ─────────────────────────────────────────────────────────

export type PatternType = 'stack' | 'company_type' | 'role' | 'seniority' | 'twin' | 'platform';

export interface LearningPattern {
  id: string;
  patternType: PatternType;
  patternKey: string;          // ex: 'Python', 'fintech', 'AI Engineer', 'twin_ai_engineer'

  totalApplications: number;
  interviews: number;
  rejections: number;
  noResponse: number;
  offers: number;

  interviewRate: number;       // interviews / totalApplications (0–1)
  avgHireScore: number;
  avgResponseDays?: number;

  lastUpdated: string;
}

// ── CV Versions ───────────────────────────────────────────────────────────────

export interface CvVersion {
  id: string;
  twinId: TwinId;
  versionLabel: string;        // 'v1', 'v1_ats_nubank', 'v2_focused_ai'
  contentMd: string;
  pdfPath?: string;

  applications: number;
  interviews: number;
  interviewRate: number;

  isBase: boolean;             // true = base version for this twin
  parentVersionId?: string;    // if derived from another version
  createdAt: string;
}

// ── HIE Config ────────────────────────────────────────────────────────────────

export const HIRE_THRESHOLD  = 75;   // minimum interviewProbability to trigger application
export const REVIEW_THRESHOLD = 60;  // show in dashboard for manual review

export const HIE_SCORE_WEIGHTS = {
  technicalFit:    0.35,
  seniorityFit:    0.20,
  salaryFit:       0.15,
  atsProbability:  0.15,
  historicalScore: 0.10,
  locationFit:     0.05,
} as const;

// Competition penalty applied to interviewProbability (not hireScore)
export const COMPETITION_PENALTY: Record<CompetitionLevel, number> = {
  low:       0,
  medium:   -5,
  high:    -12,
  very_high: -20,
};
