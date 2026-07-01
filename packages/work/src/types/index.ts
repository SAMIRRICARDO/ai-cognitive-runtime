// packages/work/src/types/index.ts

export type ExperienceLevel =
  | 'INTERNSHIP'
  | 'ENTRY_LEVEL'
  | 'ASSOCIATE'
  | 'MID_SENIOR_LEVEL'
  | 'DIRECTOR'
  | 'EXECUTIVE';

export type JobType =
  | 'FULL_TIME'
  | 'PART_TIME'
  | 'CONTRACT'
  | 'TEMPORARY'
  | 'INTERNSHIP'
  | 'VOLUNTEER'
  | 'OTHER';

export type DatePosted = 'any' | 'month' | 'week' | '24h';

export type ApplicationStatus =
  | 'scanned'
  | 'filtered_out'
  | 'queued'
  | 'applying'
  | 'applied'
  | 'questionnaire_pending'
  | 'questionnaire_done'
  | 'rejected'
  | 'interview'
  | 'error';

export type ApplyAction = 'APPLY' | 'REVIEW' | 'SKIP';

// ─── Config ─────────────────────────────────────────────────────────────────

export interface LinkedInCredentials {
  email: string;
  password: string;
}

export interface JobSearchConfig {
  keywords: string[];
  locations: string[];
  experienceLevels: ExperienceLevel[];
  jobTypes: JobType[];
  datePosted: DatePosted;
  easyApplyOnly: boolean;
  remoteOnly: boolean;
  workType?: 'ONSITE' | 'REMOTE' | 'HYBRID' | 'ONSITE_HYBRID';
  companyBlacklist: string[];
  titleBlacklist: string[];
  maxApplicationsPerRun: number;
}

// ─── Job ────────────────────────────────────────────────────────────────────

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  linkedinUrl: string;
  description: string;
  isEasyApply: boolean;
  postedAt?: string;
  scannedAt: string;
}

export interface JobScore {
  jobId: string;
  titleFit: number;    // 0–10
  stackFit: number;    // 0–10
  companyFit: number;  // 0–10
  dealBreaker: boolean;
  total: number;       // sum; threshold >= 21 → APPLY
  action: ApplyAction;
  reason: string;
}

export interface JobApplication {
  id: string;
  job: Job;
  score: JobScore;
  status: ApplicationStatus;
  appliedAt?: string;
  notes?: string;
  questionnaireAnswers?: QuestionnaireAnswer[];
}

// ─── Questionnaire ───────────────────────────────────────────────────────────

export interface QuestionnaireQuestion {
  id: string;
  text: string;
  type: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'number';
  options?: string[];
  required: boolean;
}

export interface QuestionnaireAnswer {
  questionId: string;
  questionText: string;
  answer: string;
}

// ─── RAG ─────────────────────────────────────────────────────────────────────

export interface VaultChunk {
  id: string;
  source: string;      // relative path within vault
  section: string;     // heading context
  content: string;
  tags: string[];
}

export interface RAGContext {
  chunks: VaultChunk[];
  query: string;
  topK: number;
}
