// packages/work/src/application/ApplicationService.ts
// Orquestrador principal — conecta todos os componentes de candidatura.

import { Page } from 'playwright';
import path from 'path';
import { Job } from '../types/index.js';
import { ApplicationStateMachine } from './ApplicationStateMachine.js';
import { EvidenceCollector } from './EvidenceCollector.js';
import { ApplicationTracer } from './ApplicationTracer.js';
import { ValidationEngine } from './ValidationEngine.js';
import { RetryEngine } from './RetryEngine.js';
import { LinkedInApplyEngine } from './LinkedInApplyEngine.js';
import { ApplicationRepository } from './ApplicationRepository.js';
import {
  ApplicationResult,
  ApplicationMetrics,
  ProcessOptions,
  ApplicationState,
} from './types.js';
import { runHealthCheck, HealthCheckResult } from './HealthCheck.js';
import { ApplicationTruthEngine } from './ApplicationTruthEngine.js';
import { ErrorClassifier } from './ErrorClassifier.js';

export type { HealthCheckResult };

export class ApplicationService {
  private readonly logsBaseDir: string;
  private readonly validation  = new ValidationEngine();
  private readonly retry       = new RetryEngine();
  private readonly truthEngine = new ApplicationTruthEngine();
  private readonly errorClassifier = new ErrorClassifier();

  constructor(
    private page: Page,
    private repository: ApplicationRepository,
    logsBaseDir?: string,
  ) {
    this.logsBaseDir = logsBaseDir ?? path.resolve(process.cwd(), '.vraxia-work', 'logs');
  }

  async process(job: Job, options: ProcessOptions): Promise<ApplicationResult> {
    const traceId    = options.traceId ?? `trc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const evidenceDir = path.join(this.logsBaseDir, `application_${job.id}`);
    const startTime  = Date.now();
    let attempts     = 0;

    // ── Inicializa componentes ─────────────────────────────────────────────
    const evidence = new EvidenceCollector(evidenceDir, job.id, job.title, job.company, job.platform ?? 'linkedin');
    const tracer   = new ApplicationTracer(job.id, evidenceDir, traceId);

    const sm = new ApplicationStateMachine(job.id, (transition) => {
      tracer.addTransition(transition);
      options.onStateChange?.(transition.to, { from: transition.from, durationMs: transition.durationMs });

      this.repository.updateState(job.id, transition.to, {
        traceId,
        evidenceDir,
        notes: transition.metadata ? JSON.stringify(transition.metadata).slice(0, 200) : undefined,
      });

      console.log(
        `[ApplicationService:${job.id}] ${transition.from} → ${transition.to}` +
        ` (${transition.durationMs}ms)`,
      );
    });

    // Listeners de rede NUNCA em dry-run (sem navegação real = sem respostas).
    // detachListeners() é chamado no finally para evitar acumulação na mesma Page
    // (cross-contamination: sem remoção, 10 jobs = 10 handlers simultâneos disparando
    // em cada resposta, contaminando networkRequests de jobs anteriores).
    if (!options.dryRun) {
      evidence.attachListeners(this.page);
    }

    // ── DRY RUN: simula transições sem acionar browser ─────────────────────
    if (options.dryRun) {
      console.log(`[ApplicationService] DRY RUN — ${job.title} @ ${job.company}`);
      for (const s of ['starting', 'opening_job', 'opening_easy_apply', 'filling_questions', 'submitting', 'submitted'] as ApplicationState[]) {
        sm.tryTransition(s);
        await new Promise(r => setTimeout(r, 10));
      }
      this.repository.updateState(job.id, 'submitted', {
        traceId, evidenceDir,
        notes: 'dry-run: aprovado pelo MatchAgent, aguardando execução real',
      });
      return {
        jobId: job.id,
        finalState: 'submitted',
        confirmed: false,
        metrics: this.buildMetrics(job.id, sm, evidence, 0, Date.now() - startTime),
        evidenceDir,
        attempts: 0,
        error: undefined,
      };
    }

    // ── Run real ───────────────────────────────────────────────────────────
    const engine = new LinkedInApplyEngine(this.page);

    try {
      const result = await engine.apply(job.linkedinUrl, {
        resumePath:   options.resumePath,
        dryRun:       false,
        onQuestion:   options.onQuestion,
        onFieldFilled: options.onFieldFilled,
        stateMachine: sm,
        evidence,
        tracer,
        retryEngine:  this.retry,
        validation:   this.validation,
        maxRetries:   options.maxRetries ?? 1,
      });

      attempts = result.attempts;

      await tracer.flush().catch(() => {});
      await evidence.writeManifest(sm.getState(), 'trace.json', 'timeline.json').catch(() => {});

      this.repository.updateState(job.id, sm.getState(), {
        traceId,
        evidenceDir,
        validationMethod:     result.validation?.method,
        validationConfidence: result.validation?.confidence,
        totalDurationMs:      Date.now() - startTime,
        retryCount:           Math.max(0, attempts - 1),
      });

      const appResult: ApplicationResult = {
        jobId:      job.id,
        finalState: sm.getState(),
        confirmed:  sm.getState() === 'confirmed',
        validation: result.validation,
        metrics:    this.buildMetrics(job.id, sm, evidence, attempts, Date.now() - startTime, result.validation?.method),
        evidenceDir,
        attempts,
      };

      const health = runHealthCheck(appResult, evidenceDir);
      if (!health.healthy) {
        console.warn(`[ApplicationService:${job.id}] ⚠️ Health check REPROVADO (score ${health.score}/100): ${health.warnings.join('; ')}`);
      } else {
        console.log(`[ApplicationService:${job.id}] ✅ Health check OK (score ${health.score}/100)`);
      }

      // ── Truth Engine: avaliação objetiva com provas ────────────────────────
      const truth = this.truthEngine.evaluate({
        jobId:            job.id,
        traceId,
        evidenceDir,
        finalState:       sm.getState(),
        validationResult: result.validation,
        healthScore:      health.score,
      });
      this.repository.saveTruth(job.id, truth, health.score);
      console.log(`[ApplicationService:${job.id}] 🔍 Truth: ${truth.confidence} (score ${truth.validationScore}/100) | ${truth.summary.slice(0, 80)}`);

      return appResult;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const stack  = err instanceof Error ? err.stack : undefined;

      await evidence.captureScreenshot(this.page, 'fatal_error').catch(() => {});
      await evidence.captureHtml(this.page, 'fatal_error').catch(() => {});
      tracer.addError('fatal', this.page.url(), err);

      if (!sm.isTerminal()) sm.tryTransition('failed', { error: errMsg });

      await tracer.flush().catch(() => {});
      await evidence.writeManifest('failed', 'trace.json', 'timeline.json').catch(() => {});

      // Classifica o erro automaticamente
      const classifiedError = this.errorClassifier.classify(errMsg, sm.getState());
      console.error(`[ApplicationService:${job.id}] Erro ${classifiedError.category}: ${errMsg.slice(0, 120)}`, stack?.slice(0, 200));
      console.error(`[ApplicationService:${job.id}] RCA: ${classifiedError.rca}`);

      this.repository.updateState(job.id, 'failed', {
        traceId,
        evidenceDir,
        notes:          errMsg.slice(0, 500),
        totalDurationMs: Date.now() - startTime,
        retryCount:     Math.max(0, attempts - 1),
      });
      this.repository.saveError(job.id, classifiedError);

      const failResult: ApplicationResult = {
        jobId:      job.id,
        finalState: 'failed',
        confirmed:  false,
        metrics:    this.buildMetrics(job.id, sm, evidence, attempts, Date.now() - startTime),
        evidenceDir,
        attempts,
        error:      errMsg,
      };
      const failHealth = runHealthCheck(failResult, evidenceDir);

      // Truth Engine mesmo em falha — grava FAILED com evidências disponíveis
      const failTruth = this.truthEngine.evaluate({
        jobId:       job.id,
        traceId,
        evidenceDir,
        finalState:  'failed',
        healthScore: failHealth.score,
      });
      this.repository.saveTruth(job.id, failTruth, failHealth.score);

      return failResult;
    } finally {
      // Remove listeners da Page independentemente de sucesso ou falha.
      // Obrigatório para evitar acumulação entre candidaturas consecutivas.
      evidence.detachListeners(this.page);
    }
  }

  private buildMetrics(
    jobId: string,
    sm: ApplicationStateMachine,
    evidence: EvidenceCollector,
    attempts: number,
    totalMs: number,
    validationMethod?: string,
  ): ApplicationMetrics {
    return {
      jobId,
      totalDurationMs:  totalMs,
      durationByStep:   sm.getDurationByStep(),
      screenshotCount:  evidence.getScreenshotCount(),
      questionCount:    0,
      retryCount:       Math.max(0, attempts - 1),
      finalState:       sm.getState(),
      validationMethod: validationMethod as ApplicationMetrics['validationMethod'],
      captchaDetected:  false,
      blockDetected:    false,
    };
  }
}
