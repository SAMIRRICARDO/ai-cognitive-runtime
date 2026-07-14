// packages/work/src/index.ts

export * from './types/index.js';
export * from './types/hire-intelligence.js';
export { LinkedInSession } from './engine/session.js';
export { JobSearchEngine } from './engine/search.js';
export { GupySearchEngine, GupyApplyEngine } from './engine/gupy.js';
export type { GupyJob, GupySearchConfig, GupyApplyOptions, GupyPersonalData } from './engine/gupy.js';
export { ObsidianVaultLoader } from './rag/vault-loader.js';
export { VaultRetriever } from './rag/retriever.js';
export { JobFilterAgent } from './agents/JobFilterAgent.js';
export { QuestionnaireLogger } from './agents/QuestionnaireLogger.js';
export type { QuestionnaireLogEntry } from './agents/QuestionnaireLogger.js';
export { StatusTracker } from './agents/StatusTracker.js';
export { ModalityDetector } from './engine/modality-detector.js';
export type { Modality, ModalityResult } from './engine/modality-detector.js';
export { QACache } from './agents/cache.js';
export type { SchedulerConfig, ExecutionWindow } from './scheduler/config.js';
export { DEFAULT_CONFIG, pickRandomWindow, randomMinuteInWindow } from './scheduler/config.js';
export { randomUserAgent, humanDelay, sessionExpired, detectBanSignal, jitterMs } from './scheduler/anti-detection.js';

// ── Hire Intelligence Engine (HIE) ────────────────────────────────────────────
export { ProfessionalTwinsStore } from './twin/professional-twins.js';
export { HireScoreAgent } from './agents/HireScoreAgent.js';
export { TwinSelectorAgent } from './agents/TwinSelectorAgent.js';
export type { TwinSelectionResult, TwinCompatibility } from './agents/TwinSelectorAgent.js';
export { ATSOptimizerAgent } from './agents/ATSOptimizerAgent.js';
export type { ATSOptimizationResult } from './agents/ATSOptimizerAgent.js';
export { LearningEngine } from './engine/learning-engine.js';
export type { RecordOutcomeInput } from './engine/learning-engine.js';
