// packages/work/src/types/index.ts

export type Platform = 'linkedin' | 'gupy' | 'catho';

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

// Extensão para campos de explainability gravados pela ApplicationRepository
export interface ApplicationExplainability {
  reasonApply?: string;
  reasonScore?: string;
  reasonFilter?: string;
  traceId?: string;
  evidenceDir?: string;
  validationMethod?: string;
  validationConfidence?: string;
  applicationState?: string;   // estado granular (confirmed, submitting, etc.)
}

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

export type ApplyType = 'easy_apply' | 'greenhouse' | 'lever' | 'workday' | 'external';

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  linkedinUrl: string;
  description: string;
  isEasyApply: boolean;
  applyType?: ApplyType;
  externalApplyUrl?: string;
  postedAt?: string;
  scannedAt: string;
  platform?: Platform;
}

export interface CathoJob extends Job {
  cathoJobId: string;
  applicationUrl: string;
  salaryRange?: string;
  benefits?: string[];
  companySize?: string;
}

export interface CathoSearchConfig {
  keywords: string[];
  location: string;
  remote: boolean;
  contractType?: 1 | 2 | 3; // 1=CLT 2=PJ 3=Estágio
  titleBlacklist?: string[];
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
  type: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'number' | 'combobox' | 'tel';
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

// ─── Career OS — Digital Twin ────────────────────────────────────────────────

export interface TwinIdentity {
  name: string;
  email: string;
  phone: string;
  cpf?: string;
  location: string;
  languages: string[];
  linkedin: string;
  github: string;
}

export interface TwinEducation {
  institution: string;
  degree: string;   // 'Graduação', 'Pós-graduação', etc.
  course: string;   // 'Tecnologia da Informação'
  year: number;
}

export interface TwinProfessional {
  currentTitle: string;
  yearsExp: number;
  seniority: 'junior' | 'pleno' | 'senior' | 'lead' | 'architect' | 'director';
  skills: string[];
  stack: string[];
  industries: string[];
}

export interface TwinProject {
  name: string;
  description: string;
  tech: string[];
  url: string;
  highlights: string[];
}

export interface TwinPreferences {
  targetSalary: number;
  currency: string;
  remote: boolean;
  workTypes: string[];
  locations: string[];
  companySizes: string[];
}

export interface TwinBehavioral {
  strengths: string[];
  weaknesses: string[];
  motivations: string[];
  values: string[];
  workStyle: string;
}

export interface TwinHistoryEntry {
  company: string;
  role: string;
  period: string;
  highlights: string[];
  tech: string[];
}

export interface TwinFinancial {
  currentSalary: number;
  targetSalary: number;
  currency: string;
  negotiable: boolean;
}

export interface TwinLearning {
  certifications: string[];
  studying: string[];
  goals: string[];
  education?: TwinEducation[];
}

export interface CandidateTwin {
  id: string;
  createdAt: string;
  updatedAt: string;
  identity: TwinIdentity;
  professional: TwinProfessional;
  projects: TwinProject[];
  preferences: TwinPreferences;
  behavioral: TwinBehavioral;
  history: TwinHistoryEntry[];
  financial: TwinFinancial;
  learning: TwinLearning;
}

// ─── Career OS — Match Agent ─────────────────────────────────────────────────

export interface MatchDimensions {
  matchTecnico: number;      // 0–35
  matchSalarial: number;     // 0–20
  matchSenioridade: number;  // 0–20
  matchCultural: number;     // 0–10
  matchIdioma: number;       // 0–10
  matchLocalizacao: number;  // 0–5
}

export interface MatchScore {
  jobId: string;
  total: number;             // 0–100
  dimensions: MatchDimensions;
  dealBreaker: boolean;
  action: ApplyAction;
  reason: string;
  reasonApply?: string;
  reasonScore?: string;
  reasonFilter?: string;
}

// ─── Career OS — ATS ────────────────────────────────────────────────────────

export interface ATSResult {
  jobId: string;
  atsScore: number;          // 0–100
  missingKeywords: string[];
  presentKeywords: string[];
  improvementParagraph: string;
  recommendation: string;
}

// ─── Career OS — Chat ────────────────────────────────────────────────────────

export type ChatIntent =
  | 'HUNT'
  | 'RESUME'
  | 'INTERVIEW'
  | 'SALARY'
  | 'ANALYTICS'
  | 'NETWORK'
  | 'CAREER'
  | 'EXPLAIN'
  | 'SETTINGS';

export interface QuickAction {
  label: string;
  action: string;
  icon?: string;
}

export interface ChatResponse {
  reply: string;
  intent: ChatIntent;
  actions: QuickAction[];
  data?: unknown;
}

// ─── Career OS — Career Memory ───────────────────────────────────────────────

export interface CompanyInsight {
  company: string;
  taxaResposta: number;
  tempoMedio: number;
  recrutadores: string[];
  tecnologiasPedidas: string[];
  updatedAt: string;
}

export interface KeywordPerformance {
  keyword: string;
  aparicoes: number;
  callbacks: number;
  conversao: number;
}

export interface QuestionBankEntry {
  pergunta: string;
  empresa: string;
  respostas: string[];
  melhorResposta: string;
  updatedAt: string;
}

export interface ResumePerformance {
  versaoCv: string;
  candidaturas: number;
  callbacks: number;
  taxa: number;
}

// ─── Career OS — Salary Advisor ──────────────────────────────────────────────

export interface SalaryAdvice {
  jobId?: string;
  recommendedSalary: number;
  negotiationRange: { min: number; max: number };
  marketPercentile: number;      // 0–100
  negotiationTips: string[];
  bestMomentToNegotiate: string;
  scriptSuggestion: string;      // frase pronta para negociar
  currency: string;
}

// ─── Career OS — Learning Agent ──────────────────────────────────────────────

export interface SkillsMapItem {
  skill: string;
  hasIt: boolean;
  marketDemand: number;          // aparições no keyword_performance
  priority: 'alta' | 'media' | 'baixa';
  studyResource: string;
}

export interface LearningRoadmap {
  generatedAt: string;
  gaps: SkillsMapItem[];
  immediate: string[];           // aprender agora (1–4 semanas)
  midTerm: string[];             // 1–3 meses
  longTerm: string[];            // 3–6 meses
  weeklyGoal: string;
  estimatedHoursTotal: number;
  topGapByImpact: string;
}

// ─── Career OS — Networking / CRM ───────────────────────────────────────────

export interface RecruiterInteraction {
  date: string;
  channel: 'linkedin' | 'email' | 'whatsapp' | 'outro';
  message: string;
}

export interface RecruiterContact {
  id: string;
  name: string;
  company: string;
  linkedinUrl: string;
  email: string;
  role: string;
  lastContact: string;
  status: 'ativo' | 'inativo' | 'convertido' | 'rejeitado';
  notes: string;
  interactions: RecruiterInteraction[];
  createdAt: string;
}

// ─── Career OS — Analytics enriched ─────────────────────────────────────────

export interface RejectionReason {
  category: string;
  count: number;
  examples: string[];
}

export interface HireProbability {
  score: number;           // 0–100
  confidence: 'baixa' | 'media' | 'alta';
  factors: { label: string; impact: 'positivo' | 'negativo'; weight: number }[];
  recommendation: string;
}
