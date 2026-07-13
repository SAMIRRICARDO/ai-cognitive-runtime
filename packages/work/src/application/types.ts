// packages/work/src/application/types.ts
// Tipos da máquina de estados, evidências e métricas de candidatura

import type { QuestionnaireQuestion } from '../types/index.js';

// ── Estados da Máquina ───────────────────────────────────────────────────────
// Ciclo de vida completo: descoberta → apply → validação → carreira

export type ApplicationState =
  // Pré-apply
  | 'discovered'         // vaga encontrada pelo search engine
  | 'queued'             // aguardando apply (já pontuada)
  | 'already_applied'    // duplicata detectada — não tentar novamente
  // Apply flow
  | 'starting'
  | 'opening_job'
  | 'opening_easy_apply'
  | 'uploading_resume'
  | 'filling_questions'
  | 'reviewing'
  | 'submitting'
  | 'submitted'
  | 'validating'         // rodando validação pós-submit
  // Estados terminais do apply
  | 'confirmed'
  | 'failed'
  | 'cancelled'
  | 'blocked'
  | 'timeout'
  | 'retrying'
  // Ciclo de vida pós-apply (atualizados via dashboard / manualmente)
  | 'rejected'
  | 'interview'
  | 'offer'
  | 'hired';

export const TERMINAL_STATES: readonly ApplicationState[] = [
  'confirmed', 'failed', 'cancelled', 'blocked', 'timeout',
  'already_applied', 'rejected', 'hired',
];

export const CAREER_LIFECYCLE_STATES: readonly ApplicationState[] = [
  'rejected', 'interview', 'offer', 'hired',
];

// VALID_TRANSITIONS — the proprietary state transition topology is defined in the private implementation.

// ── Transições ───────────────────────────────────────────────────────────────

export interface StateTransition {
  from: ApplicationState;
  to: ApplicationState;
  timestamp: string;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

// ── Trace / Telemetria ────────────────────────────────────────────────────────

export interface TraceEvent {
  timestamp: string;
  step: string;
  url: string;
  selector?: string;
  action?: string;
  durationMs: number;
  result: 'ok' | 'error' | 'skip' | 'retry';
  error?: string;
  stack?: string;
  retryNumber?: number;
  screenshotFile?: string;
  metadata?: Record<string, unknown>;
}

// ── Rede ─────────────────────────────────────────────────────────────────────

export interface NetworkRequest {
  url: string;
  method: string;
  status: number;
  timestamp: string;
  requestBody?: string;
  responseBody?: string;
  isApplicationRelated: boolean;
}

// ── Evidências ───────────────────────────────────────────────────────────────

export interface EvidenceManifest {
  jobId: string;
  company: string;
  jobTitle: string;
  platform: string;
  startedAt: string;
  finishedAt?: string;
  finalState: ApplicationState;
  screenshots: string[];
  htmlCaptures: string[];
  traceFile: string;
  timelineFile: string;
  networkFile: string;
  consoleFile: string;
}

// ── Validação ─────────────────────────────────────────────────────────────────

export type ValidationMethod =
  | 'my_jobs_applied'
  | 'network_response'
  | 'page_transition'
  | 'confirmation_text'
  | 'none';

export interface ValidationResult {
  confirmed: boolean;
  method: ValidationMethod;
  confidence: 'high' | 'medium' | 'low';
  details: string;
  evidence?: Record<string, unknown>;
}

// ── Tentativas (DB) ───────────────────────────────────────────────────────────

export interface ApplicationAttempt {
  id: string;
  applicationId: string;
  attemptNumber: number;
  state: ApplicationState;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  selector?: string;
  url?: string;
  error?: string;
  stack?: string;
  screenshotPath?: string;
  htmlPath?: string;
  traceId: string;
  retryOf?: string;
}

// ── Métricas ──────────────────────────────────────────────────────────────────

export interface ApplicationMetrics {
  jobId: string;
  totalDurationMs: number;
  durationByStep: Record<string, number>;
  screenshotCount: number;
  questionCount: number;
  retryCount: number;
  finalState: ApplicationState;
  validationMethod?: ValidationMethod;
  captchaDetected: boolean;
  blockDetected: boolean;
}

// ── Opções de Processamento ──────────────────────────────────────────────────

export interface ProcessOptions {
  dryRun: boolean;
  resumePath: string;
  onQuestion: (q: QuestionnaireQuestion) => Promise<string>;
  onFieldFilled?: (label: string, value: string) => void;
  onStateChange?: (state: ApplicationState, metadata?: Record<string, unknown>) => void;
  maxRetries?: number;
  traceId?: string;
}

// ── Resultado Final ───────────────────────────────────────────────────────────

export interface ApplicationResult {
  jobId: string;
  finalState: ApplicationState;
  confirmed: boolean;
  validation?: ValidationResult;
  metrics: ApplicationMetrics;
  evidenceDir: string;
  attempts: number;
  error?: string;
}

// ── Resultado Interno do Engine ───────────────────────────────────────────────

export interface EngineResult {
  success: boolean;
  attempts: number;
  validation?: ValidationResult;
}

// ── Truth Engine ──────────────────────────────────────────────────────────────

/**
 * TruthStatus representa o resultado da auditoria de evidências objetivas.
 *
 * VERIFIED  — pelo menos uma prova hard (rede, My Jobs, ATS) confirma o envio.
 * PROBABLE  — evidências parciais indicam envio mas sem prova hard.
 * REJECTED  — nenhuma evidência de envio encontrada após análise.
 * UNKNOWN   — candidatura não avaliada pelo Truth Engine ainda.
 * EXPIRED   — avaliação expirou (candidatura antiga sem evidências acessíveis).
 *
 * NUNCA confundir com ApplicationState (estado do workflow do robô).
 */
export type TruthStatus =
  | 'VERIFIED'   // prova objetiva: network 2xx, My Jobs Applied, ATS
  | 'PROBABLE'   // evidências parciais: texto confirmação, redirect, health alto
  | 'REJECTED'   // evidências apontam falha, nenhuma prova de envio
  | 'UNKNOWN'    // ainda não avaliado pelo Truth Engine
  | 'EXPIRED';   // avaliação não pode mais ser feita (sem evidências disponíveis)

/** Alias para TruthStatus — mantido para compatibilidade interna. */
export type ConfidenceLevel = TruthStatus;

export type ProofType =
  | 'network_submit_200'   // POST para endpoint submit → HTTP 2xx
  | 'my_jobs_applied'      // vaga encontrada em My Jobs > Applied
  | 'confirmation_text'    // texto "candidatura enviada" detectado na página
  | 'url_redirect'         // redirect para URL pós-apply (my-items, /jobs/?)
  | 'ats_confirmation'     // ATS externo (Greenhouse etc.) confirmou
  | 'health_check_passed'  // health score ≥ 80
  | 'screenshot_exists'    // pelo menos 1 screenshot capturado
  | 'trace_complete';      // trace.json com submit event registrado

export interface ApplicationProof {
  type: ProofType;
  weight: number;
  description: string;
  evidence: Record<string, unknown>;
  timestamp: string;
}

export interface TruthRecord {
  jobId: string;
  traceId: string;
  evaluatedAt: string;
  confidence: TruthStatus;
  validationScore: number;   // 0-100
  proofs: ApplicationProof[];
  primaryProof?: ApplicationProof;
  evidenceDir: string;
  summary: string;
}

// ── Error Classification ──────────────────────────────────────────────────────

export type ErrorCategory =
  | 'DOM_ERROR'
  | 'LOGIN_ERROR'
  | 'CAPTCHA_ERROR'
  | 'SESSION_ERROR'
  | 'TIMEOUT_ERROR'
  | 'ATS_ERROR'
  | 'UPLOAD_ERROR'
  | 'SUBMIT_ERROR'
  | 'LLM_ERROR'
  | 'NAVIGATION_ERROR'
  | 'OAUTH_ERROR'
  | 'TOKEN_ERROR'
  | 'DATABASE_ERROR'
  | 'API_ERROR'
  | 'RATE_LIMIT_ERROR'
  | 'ANTI_BOT_ERROR'
  | 'UNKNOWN_ERROR';

export interface ApplicationError {
  category: ErrorCategory;
  message: string;
  rca: string;              // Root Cause Analysis gerado automaticamente
  recommendation: string;  // ação recomendada
  retryable: boolean;
  state: ApplicationState;
  timestamp: string;
}
