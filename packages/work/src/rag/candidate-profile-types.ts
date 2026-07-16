// packages/work/src/rag/candidate-profile-types.ts
// Shared types, enums, and pluggable interfaces for the SSoT Profile System.

// ── Decision Layer ─────────────────────────────────────────────────────────────

export enum DecisionLayer {
  CANDIDATE_FACT = 'CANDIDATE_FACT',
  HARD_RULE      = 'HARD_RULE',
  CACHE          = 'CACHE',
  FAQ            = 'FAQ',
  LLM            = 'LLM',
  FALLBACK       = 'FALLBACK',
}

// ── Question Intent ────────────────────────────────────────────────────────────

export enum QuestionIntent {
  CAPABILITY   = 'CAPABILITY',
  EXPERIENCE   = 'EXPERIENCE',
  AVAILABILITY = 'AVAILABILITY',
  IDENTITY     = 'IDENTITY',
  QUANTITATIVE = 'QUANTITATIVE',
  PREFERENCE   = 'PREFERENCE',
  COMPLIANCE   = 'COMPLIANCE',
  UNKNOWN      = 'UNKNOWN',
}

// ── Fact Category ──────────────────────────────────────────────────────────────

export enum FactCategory {
  TECHNICAL  = 'technical',
  TOOL       = 'tool',
  CLOUD      = 'cloud',
  LEGAL      = 'legal',
  SOFT_SKILL = 'soft_skill',
}

// ── Decision Trace (Explainability Engine) ─────────────────────────────────────

export interface DecisionTrace {
  layer: DecisionLayer;
  intent: QuestionIntent;
  factKey?: string;
  trigger?: string;
  confidence?: number;
  latencyMs: number;
  cacheHit?: boolean;
}

// ── Profile Data Types ─────────────────────────────────────────────────────────

export interface CandidateFact {
  value: boolean;
  triggers: string[];
  confidence: number;
  category?: FactCategory;
}

export interface SkillEntry {
  hasExperience: boolean;
  production: boolean;
  years: number;
  expertiseLevel: number;
  confidence: number;
  level: string;
  frameworks: string[];
  projects: string[];
  parentSkill?: string;
}

export interface EvidenceProject {
  name: string;
  description: string;
  url?: string;
}

export interface EvidenceSourceLink {
  sourceType: 'github' | 'production' | 'linkedin' | 'portfolio' | 'internal';
  company?: string;
  period?: string;
  url?: string;
}

export interface FactEvidence {
  summary: string;
  projects?: EvidenceProject[];
  models?: string[];
  techniques?: string[];
  patterns?: string[];
  companies?: string[];
  context?: string;
  sourceLinks?: EvidenceSourceLink[];
}

export interface ProfileMetadata {
  schemaVersion: string;
  profileId: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  migrationVersion?: number;
}

export interface CandidateProfile {
  schemaVersion: string;
  profileId: string;
  ownerId: string;
  profileVersion: number;
  candidateId: string;
  updatedAt: string;
  metadata?: ProfileMetadata;
  normalizationAliases?: Record<string, string>;
  candidateFacts: Record<string, CandidateFact>;
  skills: Record<string, SkillEntry>;
  evidence: Record<string, FactEvidence>;
}

// ── Pluggable Interfaces ───────────────────────────────────────────────────────

export interface IBinaryAnswerer {
  isBinaryQuestion(text: string): boolean;
  answerBinaryQuestion(text: string, options?: string[]): string | null;
}

export interface IEvidenceEngine {
  buildEvidenceContext(questionText: string): string;
}

export interface ISkillGraph {
  getSkill(name: string): SkillEntry | undefined;
  getProficiencyLevel(name: string): string;
  getParentSkill(name: string): string | undefined;
}

export interface IConfidenceEngine {
  getConfidence(nameOrFactKey: string): number;
}

export interface IIntentClassifier {
  classifyIntent(text: string): QuestionIntent;
}

// ── Observability ──────────────────────────────────────────────────────────────

export interface LayerMetrics {
  hits: number;
  misses: number;
  totalLatencyMs: number;
}

export interface MetricsSnapshot {
  totalQuestions: number;
  cacheHitRate: number;
  avgLatencyMs: number;
  byLayer: Partial<Record<DecisionLayer, LayerMetrics>>;
}
