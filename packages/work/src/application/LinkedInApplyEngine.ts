// packages/work/src/application/LinkedInApplyEngine.ts
// Motor de candidatura LinkedIn com máquina de estados, observabilidade e retry.

import { Page, Locator } from 'playwright';
import { QuestionnaireQuestion } from '../types/index.js';
import { ApplicationStateMachine } from './ApplicationStateMachine.js';
import { EvidenceCollector } from './EvidenceCollector.js';
import { ApplicationTracer } from './ApplicationTracer.js';
import { ValidationEngine } from './ValidationEngine.js';
import { RetryEngine, DEFAULT_RETRY_CONFIG, isSubmitAmbiguous } from './RetryEngine.js';
import { EngineResult, ApplicationState } from './types.js';

const delay = (min: number, max: number) =>
  new Promise<void>(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));

// LinkedIn mudou para <dialog open data-testid="dialog"> com data-sdui-screen*=EasyApply.
// Mantemos os seletores legados como fallback.
const MODAL_SEL = [
  'dialog[open][data-testid="dialog"]',
  '[data-sdui-screen*="EasyApply"]',
  '[data-test-modal-id="easy-apply-modal"]',
  '.jobs-easy-apply-modal',
  '[data-test-modal-container]',
  '.artdeco-modal--layer-default',
].join(', ');

export interface LinkedInApplyOptions {
  resumePath: string;
  coverLetterPath?: string;
  dryRun: boolean;
  onQuestion: (q: QuestionnaireQuestion) => Promise<string>;
  onFieldFilled?: (label: string, value: string) => void;
  stateMachine: ApplicationStateMachine;
  evidence: EvidenceCollector;
  tracer: ApplicationTracer;
  retryEngine: RetryEngine;
  validation: ValidationEngine;
  maxRetries?: number;
  maxSteps?: number;
}

export class LinkedInApplyEngine {
  constructor(private page: Page) {}

  // ── Ponto de entrada ────────────────────────────────────────────────────────

  async apply(linkedinUrl: string, opts: LinkedInApplyOptions): Promise<EngineResult> {
    const { stateMachine: sm, evidence, tracer, retryEngine } = opts;
    let attemptCount = 0;
    const maxRetries = opts.maxRetries ?? 1;

    const runAttempt = async (): Promise<EngineResult> => {
      attemptCount++;
      tracer.markStep('starting');

      // ── 1. Navega para a vaga ──────────────────────────────────────────────
      if (sm.getState() === 'queued') sm.transition('starting');
      if (sm.getState() === 'starting') {
        sm.transition('opening_job');
        tracer.markStep('opening_job');
        await this.navigateToJob(linkedinUrl, evidence, tracer);
        await evidence.captureScreenshot(this.page, `step_01_job_page`);
      }

      // ── 2. Encontra e abre Easy Apply ──────────────────────────────────────
      sm.transition('opening_easy_apply');
      tracer.markStep('opening_easy_apply');
      await this.dismissBlockingDialog(); // limpa overlays pós-navegação
      const applyBtn = await this.findEasyApplyButton(evidence, tracer);
      if (!applyBtn) {
        await evidence.captureScreenshot(this.page, 'error_no_apply_btn');
        await evidence.captureHtml(this.page, 'error_no_apply_btn');
        tracer.addEvent({ step: 'find_easy_apply_btn', url: this.page.url(), result: 'error', error: 'Botão Easy Apply não encontrado' });
        sm.transition('failed', { reason: 'Botão Easy Apply não encontrado' });
        return { success: false, attempts: attemptCount };
      }

      await evidence.captureScreenshot(this.page, 'step_02_before_click');
      const flowType = await this.openEasyApply(applyBtn, evidence, tracer);
      await evidence.captureScreenshot(this.page, 'step_03_modal_open');

      // page_flow apply pages expire after ~8-10s of browser inactivity.
      // Start keepalive immediately after the apply page opens so that
      // upload, screenshot, and question-collection steps don't contribute to timeout.
      let pageFlowKeepalive: ReturnType<typeof setInterval> | undefined;
      if (flowType === 'page') {
        let kx = 760;
        pageFlowKeepalive = setInterval(() => {
          kx = kx === 760 ? 763 : 760;
          this.page.mouse.move(kx, 400).catch(() => {});
          this.page.evaluate((x: number) => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: 400, bubbles: true }));
          }, kx).catch(() => {});
        }, 2000);
      }

      // ── 3. Upload do currículo ─────────────────────────────────────────────
      sm.transition('uploading_resume');
      tracer.markStep('uploading_resume');
      await this.uploadResume(opts.resumePath, evidence, tracer);
      await evidence.captureScreenshot(this.page, 'step_04_after_upload');

      // ── 4. Preenche perguntas e avança steps ──────────────────────────────
      sm.transition('filling_questions');
      tracer.markStep('filling_questions');

      let stepCount = 0;
      const maxSteps = opts.maxSteps ?? 20;
      // Stuck detection: tracks question fingerprint across consecutive "next" clicks.
      // If the same question IDs appear after clicking Next 2+ times, the form is
      // blocked by a validation error that we can't resolve — fail fast instead of
      // burning through all maxSteps iterations (~100s).
      let prevQFingerprint = '';
      let stuckAfterNext = 0;
      let stuckAfterReview = 0;
      let prevReviewFingerprint = '';

      while (stepCount < maxSteps) {
        stepCount++;
        const stepUrl = this.page.url();
        tracer.addEvent({ step: `form_step_${stepCount}`, url: stepUrl, result: 'ok' });

        // Verifica redirect de submissão antes de qualquer ação
        if (this.isPostSubmitUrl(stepUrl)) {
          tracer.addEvent({ step: 'detect_post_submit_redirect', url: stepUrl, result: 'ok' });
          sm.tryTransition('submitting', { via: 'url_redirect' });
          sm.tryTransition('submitted',  { via: 'url_redirect' });
          break;
        }

        await this.dismissSaveModal();
        await this.handleAbandonModal();
        await this.uploadResume(opts.resumePath, evidence, tracer); // idempotente: só age se o campo existir
        const filledIds = await this.handleQuestions(opts.onQuestion, opts.onFieldFilled, tracer);

        const urlAfterFill = this.page.url();
        if (this.isPostSubmitUrl(urlAfterFill)) {
          sm.tryTransition('submitting', { via: 'url_redirect_post_questions' });
          sm.tryTransition('submitted',  { via: 'url_redirect_post_questions' });
          break;
        }

        // Drift check: only fail if URL changed AND modal also closed.
        // LinkedIn's SPA may change the URL to /jobs/view/ while keeping the
        // Easy Apply modal open — in that case we should continue, not fail.
        if (!urlAfterFill.includes('/apply')) {
          const modalAfterFill = await this.page.locator(MODAL_SEL).count() > 0;
          if (!modalAfterFill) {
            // Antes de falhar, verifica se saiu por submissão bem-sucedida
            const bodyText = await this.page.locator('body').innerText().catch(() => '');
            const isConfirmation = /candidatura enviada|application submitted|you.ve applied|parabéns|thank you|confirmação|foi enviada|sua candidatura|applied successfully/i.test(bodyText);
            if (isConfirmation) {
              if (pageFlowKeepalive) clearInterval(pageFlowKeepalive);
              tracer.addEvent({ step: `page_flow_submitted_step_${stepCount}`, url: urlAfterFill, result: 'ok', metadata: { via: 'confirmation_page' } });
              sm.tryTransition('submitting', { via: 'confirmation_page' });
              sm.tryTransition('submitted',  { via: 'confirmation_page' });
              break;
            }
            if (pageFlowKeepalive) clearInterval(pageFlowKeepalive);
            await evidence.captureScreenshot(this.page, `page_flow_drift_${stepCount}`);
            tracer.addEvent({ step: `page_flow_drift_step_${stepCount}`, url: urlAfterFill, result: 'error', error: 'URL e modal ambos fechados — formulário encerrado' });
            sm.tryTransition('failed', { reason: 'form_closed_after_questions', step: stepCount });
            return { success: false, attempts: attemptCount };
          }
          // Modal still open despite URL change — LinkedIn SPA nav, keep going
          tracer.addEvent({ step: `spa_nav_modal_alive_${stepCount}`, url: urlAfterFill, result: 'ok' });
        }

        await this.dismissSaveModal();
        await delay(150, 250);
        // Retry detectNextAction: LinkedIn SPA may briefly show a loading
        // transition after fills before navigation buttons become visible.
        // No waitForLoadState here — it wastes 1s of the 12s Easy Apply budget.
        let action: 'next' | 'review' | 'submit' | 'unknown' = 'unknown';
        for (let da = 0; da < 8; da++) {
          action = await this.detectNextAction(tracer);
          if (action !== 'unknown') break;
          if (da < 7) await delay(250, 400);
        }
        tracer.addEvent({ step: `action_detected_step_${stepCount}`, url: this.page.url(), action, result: 'ok' });

        if (action === 'submit') {
          await evidence.captureScreenshot(this.page, 'step_submit_before');
          sm.transition('submitting');
          tracer.markStep('submitting');
          await this.submitForm(evidence, tracer);
          await delay(2000, 3000);
          await evidence.captureScreenshot(this.page, 'step_submit_after');
          sm.transition('submitted');
          break;
        }

        if (action === 'review') {
          // Stuck detection for review: if same question fingerprint appears after
          // clicking "Avaliar" 2+ times, the form is not advancing to submit —
          // likely a validation error or stale SPA state. Fail fast.
          const reviewFingerprint = [...filledIds].sort().join('|');
          if (prevReviewFingerprint && reviewFingerprint && reviewFingerprint === prevReviewFingerprint) {
            stuckAfterReview++;
            if (stuckAfterReview >= 2) {
              console.warn(`[LinkedInApplyEngine] Formulário preso no review — ${stuckAfterReview} cliques em Avaliar sem avançar para Submit`);
              const networkEvidence = evidence.getNetworkRequests().some(r =>
                r.isApplicationRelated && r.method === 'POST' && r.status === 200,
              );
              if (networkEvidence) {
                if (pageFlowKeepalive) clearInterval(pageFlowKeepalive);
                tracer.addEvent({ step: `review_stuck_but_submitted_${stepCount}`, url: this.page.url(), result: 'ok', metadata: { via: 'network_post_200', stuckAfterReview } });
                sm.tryTransition('submitting', { via: 'review_stuck_network_evidence' });
                sm.tryTransition('submitted',  { via: 'review_stuck_network_evidence' });
                break;
              }
              if (pageFlowKeepalive) clearInterval(pageFlowKeepalive);
              tracer.addEvent({ step: `review_stuck_step_${stepCount}`, url: this.page.url(), result: 'error', error: `Formulário não avançou para Submit após ${stuckAfterReview} cliques em Avaliar` });
              sm.tryTransition('failed', { reason: 'review_stuck', stuckAfterReview });
              return { success: false, attempts: attemptCount };
            }
          } else {
            stuckAfterReview = 0;
            prevReviewFingerprint = reviewFingerprint;
          }
          stuckAfterNext = 0; // reset next-stuck counter when switching to review
          sm.tryTransition('reviewing', { step: stepCount });
          await this.clickNext(tracer);
          await this.page.waitForLoadState('domcontentloaded', { timeout: 1000 }).catch(() => {});
          await delay(300, 500);
          await this.dismissSaveModal();
          continue;
        }

        if (action === 'next') {
          // Stuck detection: if same question IDs appeared on this step as on the
          // previous "next" step, clicking Next isn't advancing the form (likely a
          // silent validation error from LinkedIn). Fail fast instead of looping.
          const qFingerprint = [...filledIds].sort().join('|');
          if (prevQFingerprint && qFingerprint && qFingerprint === prevQFingerprint) {
            stuckAfterNext++;
            if (stuckAfterNext >= 2) {
              console.warn(`[LinkedInApplyEngine] Formulário preso — ${stuckAfterNext} cliques em Next sem avançar (${qFingerprint.slice(0, 80)})`);
              // Before failing, check if a submit POST was captured — means form DID submit
              // despite the stuck detection (e.g. LinkedIn submits on "Next" in last step).
              const networkEvidence = evidence.getNetworkRequests().some(r =>
                r.isApplicationRelated && r.method === 'POST' && r.status === 200,
              );
              if (networkEvidence) {
                if (pageFlowKeepalive) clearInterval(pageFlowKeepalive);
                tracer.addEvent({ step: `form_stuck_but_submitted_${stepCount}`, url: this.page.url(), result: 'ok', metadata: { via: 'network_post_200', stuckAfterNext } });
                sm.tryTransition('submitting', { via: 'stuck_network_evidence' });
                sm.tryTransition('submitted',  { via: 'stuck_network_evidence' });
                break;
              }
              if (pageFlowKeepalive) clearInterval(pageFlowKeepalive);
              tracer.addEvent({ step: `form_stuck_step_${stepCount}`, url: this.page.url(), result: 'error', error: `Formulário não avançou após ${stuckAfterNext} cliques em Next` });
              sm.tryTransition('failed', { reason: 'form_stuck', stuckAfterNext });
              return { success: false, attempts: attemptCount };
            }
          } else {
            stuckAfterNext = 0;
            prevQFingerprint = qFingerprint;
          }

          await this.clickNext(tracer);
          await this.page.waitForLoadState('domcontentloaded', { timeout: 1000 }).catch(() => {});
          await delay(300, 500);
          await this.dismissSaveModal();

          // Diagnostic: capture LinkedIn validation errors that block form advancement.
          // These appear as red inline messages when required fields are invalid.
          const validationErrors = await this.page.locator([
            '[data-test-form-element-error-message]',
            '.artdeco-inline-feedback--error',
            '.jobs-easy-apply-form-element__error',
            'label.fb-dash-form-element__error',
            '[role="alert"]:visible',
          ].join(', ')).allInnerTexts().catch(() => [] as string[]);
          const errFiltered = validationErrors.map(e => e.trim()).filter(Boolean).slice(0, 5);
          if (errFiltered.length > 0) {
            console.warn(`[LinkedInApplyEngine] ⚠ Validação bloqueou Next (step ${stepCount}): ${errFiltered.join(' | ').slice(0, 300)}`);
            tracer.addEvent({ step: `next_validation_error_${stepCount}`, url: this.page.url(), result: 'error', error: errFiltered.join(' | ').slice(0, 200) });
          }

          if (this.isPostSubmitUrl(this.page.url())) {
            sm.tryTransition('submitting', { via: 'url_redirect_post_next' });
            sm.tryTransition('submitted',  { via: 'url_redirect_post_next' });
            break;
          }
          continue;
        }

        // Estado desconhecido
        if (pageFlowKeepalive) clearInterval(pageFlowKeepalive);
        await evidence.captureScreenshot(this.page, `step_unknown_${stepCount}`);
        await evidence.captureHtml(this.page, `step_unknown_${stepCount}`);
        tracer.addEvent({ step: `unknown_state_step_${stepCount}`, url: this.page.url(), result: 'error', error: 'Estado desconhecido no formulário' });
        sm.tryTransition('failed', { reason: 'Estado desconhecido no formulário', step: stepCount });
        return { success: false, attempts: attemptCount };
      }

      // page_flow keepalive no longer needed after form loop exits
      if (pageFlowKeepalive) clearInterval(pageFlowKeepalive);

      // Não deve chegar aqui se submitted
      if (sm.getState() !== 'submitted') {
        sm.tryTransition('failed', { reason: 'Limite de steps atingido sem submissão' });
        return { success: false, attempts: attemptCount };
      }

      // ── 5. Valida a candidatura ────────────────────────────────────────────
      tracer.markStep('validation');
      const validation = await opts.validation.validate(
        this.page, sm.jobId, evidence.getNetworkRequests(), evidence,
      );

      if (validation.confirmed) {
        sm.transition('confirmed', {
          method: validation.method,
          confidence: validation.confidence,
          details: validation.details,
        });
      } else {
        // submitted mas não confirmado — marcamos como failed para auditoria
        sm.transition('failed', {
          reason: 'Candidatura não confirmada por nenhum método de validação',
          lastValidation: validation,
        });
        await evidence.captureHtml(this.page, 'failed_no_confirmation');
      }

      return {
        success: sm.getState() === 'confirmed',
        attempts: attemptCount,
        validation,
      };
    };

    // ── Retry Engine ─────────────────────────────────────────────────────────
    return retryEngine.retry(runAttempt, {
      ...DEFAULT_RETRY_CONFIG,
      maxAttempts: maxRetries + 1,
      shouldRetry: (err, attempt) => {
        if (isSubmitAmbiguous(err)) {
          console.warn(`[LinkedInApplyEngine] Erro ambíguo pós-submit — sem retry: ${err.message}`);
          return false;
        }
        // Candidatura já enviada anteriormente — não tentar novamente; marcar como failed (não cancelled
        // porque o estado atual pode ser opening_easy_apply que não permite → cancelled).
        if (err.message.startsWith('already_applied:')) {
          console.warn(`[LinkedInApplyEngine] Já candidatado — sem retry: ${err.message}`);
          sm.tryTransition('failed', { reason: 'already_applied' });
          return false;
        }
        const blocked: ApplicationState[] = ['submitting', 'submitted', 'confirmed', 'failed', 'blocked'];
        if (blocked.includes(sm.getState())) return false;
        console.warn(`[LinkedInApplyEngine] Tentativa ${attempt} falhou — retry em ${attempt * 2}s: ${err.message}`);
        return true;
      },
      onRetry: (attempt, err, delay) => {
        tracer.addEvent({ step: 'retry', url: this.page.url(), result: 'retry', error: err.message, retryNumber: attempt });
        // Reset obrigatório: current → failed → retrying → starting.
        // tryTransition('retrying') diretamente só é válido de 'failed' ou 'timeout'.
        // Para estados intermediários (opening_job, filling_questions etc.) precisamos passar
        // por 'failed' primeiro — todos eles permitem essa transição.
        sm.tryTransition('failed',    { reason: 'pre-retry-reset', error: err.message });
        sm.tryTransition('retrying',  { attempt, error: err.message });
        sm.tryTransition('starting',  { retryAttempt: attempt });
      },
    });
  }

  // ── Navegação ──────────────────────────────────────────────────────────────

  private async navigateToJob(url: string, evidence: EvidenceCollector, tracer: ApplicationTracer): Promise<void> {
    const jobId = url.match(/\/jobs\/view\/(\d+)/)?.[1];
    if (jobId && this.page.url().includes(jobId)) return; // já está na página

    tracer.addEvent({ step: 'navigate_to_job', url, result: 'ok' });

    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch {
      await this.page.goto(url, { waitUntil: 'commit', timeout: 30000 }).catch(async (err) => {
        await evidence.captureHtml(this.page, 'error_navigation');
        tracer.addError('navigate_to_job', url, err);
        throw new Error(`Falha ao navegar para vaga: ${url.slice(0, 80)} — ${String(err).slice(0, 100)}`);
      });
    }

    await this.page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await delay(1200, 2500);
  }

  // ── Easy Apply button ─────────────────────────────────────────────────────

  private async findEasyApplyButton(evidence: EvidenceCollector, tracer: ApplicationTracer): Promise<Locator | null> {
    const strategies: Array<{ label: string; fn: () => Promise<Locator | null> }> = [
      // ── LinkedIn new UI (2026-07): Easy Apply is now an <a tabindex="0"> not <button> ──
      // Scoped to job top-card area first to avoid picking up Similar-Jobs sidebar anchors.
      {
        label: 'anchor in top-card container',
        fn: async () => {
          const containers = [
            '.job-details-jobs-unified-top-card__cta-container',
            '.jobs-unified-top-card__cta-container',
            '.jobs-apply-button--top-card',
            '.jobs-s-apply',
          ];
          for (const sel of containers) {
            const anchors = await this.page.locator(`${sel} a:visible`).all();
            for (const a of anchors) {
              const txt = (await a.innerText().catch(() => '')).trim();
              if (/Candidatura simplificada|Easy Apply/i.test(txt))
                return a;
            }
          }
          return null;
        },
      },
      {
        label: 'anchor hasText[Candidatura simplificada]',
        fn: async () => {
          const b = this.page.locator('a', { hasText: /^Candidatura simplificada$/ }).first();
          return (await b.count() > 0 && await b.isVisible().catch(() => false)) ? b : null;
        },
      },
      {
        label: 'anchor hasText[Easy Apply]',
        fn: async () => {
          const b = this.page.locator('a', { hasText: /^Easy Apply$/ }).first();
          return (await b.count() > 0 && await b.isVisible().catch(() => false)) ? b : null;
        },
      },
      {
        label: 'anchor tabindex text scan',
        fn: async () => {
          // Extract the target job ID from the current page URL to filter out
          // Similar-Jobs sidebar anchors that have skipRedirect with other job IDs.
          const pageUrl = this.page.url();
          const targetJobId = pageUrl.match(/\/jobs\/view\/(\d+)/)?.[1] ?? '';
          const anchors = await this.page.locator('a[tabindex]:visible').all();
          for (const a of anchors) {
            const txt = (await a.innerText().catch(() => '')).trim();
            if (!/Candidatura simplificada|Easy Apply/i.test(txt)) continue;
            const href = await a.getAttribute('href').catch(() => '');
            // Skip sidebar/similar-jobs anchors: they carry skipRedirect with a
            // currentJobId that does NOT match the target job.
            if (href && href.includes('skipRedirect')) {
              const hrefJobId = href.match(/currentJobId=(\d+)/)?.[1] ?? '';
              if (!targetJobId || hrefJobId !== targetJobId) continue;
            }
            return a;
          }
          return null;
        },
      },
      // ── Legacy selectors (button-based) ──────────────────────────────────────
      {
        label: 'role[Candidatura simplificada]',
        fn: async () => {
          const b = this.page.getByRole('button', { name: 'Candidatura simplificada' });
          return (await b.count() > 0 && await b.first().isVisible().catch(() => false)) ? b.first() : null;
        },
      },
      {
        label: 'artdeco-button--primary text match',
        fn: async () => {
          const btns = await this.page.locator('button.artdeco-button--primary').all();
          for (const btn of btns) {
            const txt = (await btn.innerText().catch(() => '')).trim();
            if (/Candidatura simplificada|Easy Apply/i.test(txt) && await btn.isVisible().catch(() => false))
              return btn;
          }
          return null;
        },
      },
      {
        label: 'aria-label',
        fn: async () => {
          const b = this.page.locator('button[aria-label*="Candidatura simplificada"], button[aria-label*="Easy Apply"]');
          return (await b.count() > 0 && await b.first().isVisible().catch(() => false)) ? b.first() : null;
        },
      },
      {
        label: 'role[Easy Apply exact]',
        fn: async () => {
          const b = this.page.getByRole('button', { name: 'Easy Apply', exact: true });
          return (await b.count() > 0 && await b.first().isVisible().catch(() => false)) ? b.first() : null;
        },
      },
      {
        label: 'structural selectors',
        fn: async () => {
          const b = this.page.locator([
            'button[data-live-test-easy-apply-button]',
            '[data-control-name="jobdetails_topcard_inapply"]',
            '.jobs-apply-button--top-card button',
            '.jobs-s-apply button',
            '.jobs-unified-top-card__cta-container button.artdeco-button--primary',
            '.job-details-jobs-unified-top-card__cta-container button',
          ].join(', '));
          return (await b.count() > 0 && await b.first().isVisible().catch(() => false)) ? b.first() : null;
        },
      },
    ];

    for (const { label, fn } of strategies) {
      const btn = await fn().catch(() => null);
      if (btn) {
        tracer.addEvent({ step: 'find_easy_apply_btn', url: this.page.url(), result: 'ok', metadata: { strategy: label } });
        return btn;
      }
    }

    // Log botões e anchors visíveis para diagnóstico
    const visibleBtns = await this.page.locator('button:visible').all();
    const visibleAnchors = await this.page.locator('a[tabindex]:visible').all();
    const labelsFn = async (els: typeof visibleBtns) => Promise.all(
      els.slice(0, 10).map(async b => {
        const aria = await b.getAttribute('aria-label').catch(() => '');
        const txt  = (await b.innerText().catch(() => '')).trim().slice(0, 60);
        return aria || txt;
      }),
    );
    const labels = [
      ...(await labelsFn(visibleBtns)),
      ...(await labelsFn(visibleAnchors)).map(l => `[a] ${l}`),
    ].filter(Boolean);
    tracer.addEvent({
      step: 'find_easy_apply_btn',
      url: this.page.url(),
      result: 'error',
      error: 'Botão Easy Apply não encontrado',
      metadata: { visibleButtons: labels },
    });
    await evidence.captureHtml(this.page, 'no_easy_apply_btn');

    return null;
  }

  // Fecha <dialog> genéricos que bloqueiem pointer events.
  // Preserva o modal de Easy Apply (data-sdui-screen*=EasyApply ou com inputs).
  private async dismissBlockingDialog(): Promise<void> {
    try {
      await this.page.evaluate(() => {
        document.querySelectorAll('dialog[open]').forEach(el => {
          // Preservar Easy Apply modal (detectado pelo SDUI screen ou formulário)
          if (el.querySelector('[data-sdui-screen*="EasyApply"]')) return;
          if (el.querySelector('[data-control-name*="apply"]')) return;
          if (el.querySelector('input, select, textarea')) return;
          // Fechar overlay genérico
          if (typeof (el as any).close === 'function') (el as any).close();
          else (el as HTMLElement).setAttribute('style', 'display:none');
        });
      }).catch(() => {});
      await this.page.waitForTimeout(300);
    } catch {}
  }

  private async openEasyApply(btn: Locator, evidence: EvidenceCollector, tracer: ApplicationTracer): Promise<'modal' | 'page'> {
    await this.dismissBlockingDialog(); // fecha dialogs antes de clicar
    const jobUrl = this.page.url(); // salva para recovery se houver redirect

    // Playwright native click gera eventos isTrusted=true — LinkedIn só chama
    // preventDefault() em <a> anchors para eventos trusted, prevenindo a navegação.
    // JS evaluate el.click() é untrusted e pode fazer o <a> navegar para o href
    // (jobs/search-results?skipRedirect=true). Usar click() nativo como primário,
    // JS como fallback para casos de overlay bloqueando o pointer.
    await btn.click({ timeout: 3000 }).catch(() =>
      btn.click({ force: true, timeout: 3000 }).catch(() =>
        btn.evaluate((el: HTMLElement) => el.click()).catch(() => {}),
      ),
    );
    // Wait up to 5s for navigation to either /apply/ page or a modal dialog.
    // Use a short poll instead of a fixed delay to avoid burning the inactivity window.
    await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    await delay(600, 900); // minimal settle time

    // Se o clique no anchor fez o LinkedIn navegar para search-results?skipRedirect=true
    // em vez de abrir o modal, retorna à vaga e reclica o botão.
    // A recovery original apenas voltava à página e esperava o modal — que nunca
    // abria porque o clique original foi consumido pela navegação e nenhum novo
    // clique era emitido.
    const urlMid = this.page.url();
    if (urlMid.includes('skipRedirect=true') || (urlMid.includes('/jobs/search-results') && !urlMid.includes('/apply'))) {
      tracer.addEvent({ step: 'easy_apply_skip_redirect_recovery', url: urlMid, result: 'ok', metadata: { jobUrl: jobUrl.slice(0, 80) } });
      await this.page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await delay(800, 1200);
      // Re-click: native click on second attempt — first click was consumed by navigation.
      const retryBtn = await this.findEasyApplyButton(evidence, tracer);
      if (retryBtn) {
        await retryBtn.scrollIntoViewIfNeeded().catch(() => {});
        await delay(300, 500);
        await retryBtn.click({ timeout: 3000 }).catch(() =>
          retryBtn.evaluate((el: HTMLElement) => el.click()).catch(() => {}),
        );
        await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
        await delay(600, 900);
        tracer.addEvent({ step: 'easy_apply_skip_redirect_reclick', url: this.page.url(), result: 'ok' });
      }
    }

    const urlAfter = this.page.url();
    if (!urlAfter.includes('linkedin.com')) {
      await this.page.goBack().catch(() => {});
      throw new Error(`Redirect externo após clicar Easy Apply: ${urlAfter.slice(0, 80)}`);
    }

    if (urlAfter.includes('/apply')) {
      // Wait for a form element to be present rather than sleeping blindly.
      await this.page.waitForSelector(
        'input, textarea, select, [role="combobox"]',
        { timeout: 5000, state: 'attached' },
      ).catch(() => {});
      await delay(400, 600); // brief final settle
      tracer.addEvent({ step: 'easy_apply_flow', url: urlAfter, result: 'ok', metadata: { type: 'page_flow' } });
      return 'page';
    }

    // LinkedIn usa <dialog open> (elemento nativo) — [role="dialog"] só funciona com atributo explícito.
    // Usa MODAL_SEL completo (inclui data-sdui-screen, data-testid e formatos legados).
    const modalOpened = await this.page
      .locator(MODAL_SEL)
      .first()
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false);

    if (!modalOpened) {
      const body = await this.page.locator('body').innerText().catch(() => '');
      if (/you.ve applied|candidatura enviada|já se candidatou/i.test(body)) {
        tracer.addEvent({ step: 'easy_apply_already_applied', url: urlAfter, result: 'skip' });
        await this.dismissSaveModal();
        // Sinaliza para o caller que já está aplicado
        throw new Error('already_applied: candidatura já enviada anteriormente');
      }
      await evidence.captureHtml(this.page, 'modal_not_opened');
      throw new Error(`Modal Easy Apply não abriu. URL: ${urlAfter.slice(0, 80)}`);
    }

    tracer.addEvent({ step: 'easy_apply_flow', url: urlAfter, result: 'ok', metadata: { type: 'modal_flow' } });
    return 'modal';
  }

  // ── Upload ─────────────────────────────────────────────────────────────────

  private async uploadResume(resumePath: string, evidence: EvidenceCollector, tracer: ApplicationTracer): Promise<void> {
    const input = this.page.locator([
      'input[type="file"][name*="resume"]',
      'input[type="file"][id*="resume"]',
      'input[type="file"][accept*="pdf"]',
      'input[type="file"]',
    ].join(', '));

    if (await input.count() === 0) return;

    try {
      await input.first().setInputFiles(resumePath);
      await delay(500, 1000);
      tracer.addEvent({ step: 'upload_resume', url: this.page.url(), result: 'ok' });
    } catch (err) {
      tracer.addError('upload_resume', this.page.url(), err);
      await evidence.captureHtml(this.page, 'error_upload');
      // Não fatal — continua mesmo sem upload (perfil LinkedIn pode ter currículo)
      console.warn(`[LinkedInApplyEngine] Falha no upload do currículo: ${String(err).slice(0, 100)}`);
    }
  }

  // ── Perguntas ──────────────────────────────────────────────────────────────

  private async handleQuestions(
    onQuestion: (q: QuestionnaireQuestion) => Promise<string>,
    onFieldFilled: ((label: string, value: string) => void) | undefined,
    tracer: ApplicationTracer,
  ): Promise<string[]> {
    // Guard: ensure we're on the apply form before collecting questions.
    // LinkedIn's SPA may navigate the URL from /apply/ back to /jobs/view/ while
    // keeping the Easy Apply modal alive — check both URL AND modal presence.
    const urlAtStart = this.page.url();
    const modalAtStart = await this.page.locator(MODAL_SEL).count() > 0;
    if (!urlAtStart.includes('/apply') && !modalAtStart) {
      // Pode ser que o formulário foi submetido numa única página e redirecionou para confirmação
      const bodyText = await this.page.locator('body').innerText().catch(() => '');
      const isConfirmation = /candidatura enviada|application submitted|you.ve applied|parabéns|thank you|confirmação|foi enviada|sua candidatura|applied successfully/i.test(bodyText);
      tracer.addEvent({ step: 'handle_questions_url_drift_early', url: urlAtStart, result: isConfirmation ? 'ok' : 'error', error: isConfirmation ? undefined : 'URL fora de /apply/ e sem modal — formulário encerrado' });
      if (!isConfirmation) console.warn(`[LinkedInApplyEngine] Formulário encerrado antes de coletar perguntas (${urlAtStart.slice(0, 80)})`);
      return [];
    }

    const questions = await this.collectQuestions();
    tracer.addEvent({ step: 'collect_questions', url: this.page.url(), result: 'ok', metadata: { count: questions.length } });

    if (questions.length === 0) return [];

    // Sequential fill: generate answer + fill field immediately for each question.
    // The previous parallel approach (Promise.all → fill) created a 15-20s window with
    // no real DOM interaction, causing LinkedIn's page_flow server session to expire.
    // Filling each field right after its LLM call keeps the form alive via actual DOM writes.
    let keepX = 760;
    const keepalive = setInterval(() => {
      keepX = keepX === 760 ? 763 : 760;
      this.page.mouse.move(keepX, 400).catch(() => {});
      this.page.evaluate((x: number) => {
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: 400, bubbles: true }));
      }, keepX).catch(() => {});
    }, 2000);

    try {
      for (const q of questions) {
        // Bail if form closed between fills (true session expiry, not SPA nav)
        const urlMid = this.page.url();
        const modalMid = await this.page.locator(MODAL_SEL).count() > 0;
        if (!urlMid.includes('/apply') && !modalMid) {
          tracer.addEvent({ step: 'handle_questions_drift_mid', url: urlMid, result: 'error', error: 'Formulário fechou durante preenchimento sequencial' });
          console.warn(`[LinkedInApplyEngine] Formulário fechou durante preenchimento (${urlMid.slice(0, 80)})`);
          break;
        }

        const answer = await onQuestion(q).catch(() => '');
        if (!answer) continue;

        try {
          await this.fillField(q, answer);
          onFieldFilled?.(q.text, answer);
          await delay(100, 200);
        } catch (err) {
          tracer.addError(`fill_field:${q.id}`, this.page.url(), err);
          console.warn(`[LinkedInApplyEngine] Erro ao preencher "${q.text.slice(0, 60)}": ${String(err).slice(0, 100)}`);
        }
      }
    } finally {
      clearInterval(keepalive);
    }

    return questions.map(q => q.id);
  }

  // Labels that identify internal UI controls or CSS/design properties — never
  // application questions. Matched against the trimmed label text (case-insensitive).
  private static readonly SKIP_LABELS = /^(pesquisar|search|buscar|procurar)\.{0,3}$|^(color|colour|opacity|background|border|shadow|radius|padding|margin|font|size|weight|width|height|scale|align|display|position|theme|variant|spacing|gap|z-index|overflow|visibility|transform|transition|animation|cursor|outline|decoration|fill|stroke)(\s*(color|style|size|weight))?$/i;

  private async collectQuestions(): Promise<QuestionnaireQuestion[]> {
    const questions: QuestionnaireQuestion[] = [];
    // Scope to the Easy Apply modal to avoid picking up UI controls from the rest of the page.
    const modalEl = this.page.locator(MODAL_SEL).first();
    const modal = (await modalEl.count()) > 0 ? modalEl : this.page.locator('body');

    const textFields = await modal.locator('input[type="text"], input[type="number"], input[type="tel"], textarea').all();
    for (const field of textFields) {
      const fieldId = await field.getAttribute('id');
      if (!fieldId) continue; // no real DOM id — fillField can't target it
      if (!(await field.isVisible().catch(() => false))) continue; // skip hidden inputs
      const label = await this.getLabelForField(field);
      if (!label) continue;
      if (LinkedInApplyEngine.SKIP_LABELS.test(label.trim())) continue;
      const tag = await field.evaluate((el: Element) => el.tagName.toLowerCase());
      const inputType = await field.getAttribute('type').catch(() => 'text') ?? 'text';
      const required = (await field.getAttribute('required')) !== null;
      const fieldType = tag === 'textarea' ? 'textarea' : inputType === 'number' ? 'number' : inputType === 'tel' ? 'tel' : 'text';
      // Diagnostic: log type + current value for numeric-looking fields to trace salary validation issues
      if (fieldId.includes('numeric') || inputType === 'number') {
        const currentVal = await field.inputValue().catch(() => '?');
        const minAttr = await field.getAttribute('min').catch(() => null) ?? '';
        const maxAttr = await field.getAttribute('max').catch(() => null) ?? '';
        const patAttr = (await field.getAttribute('pattern').catch(() => null) ?? '').slice(0, 30);
        const attrs = [minAttr && `min=${minAttr}`, maxAttr && `max=${maxAttr}`, patAttr && `pattern=${patAttr}`].filter(Boolean).join(' ');
        console.log(`[Engine/collect] #${fieldId.slice(-40)} | HTML type="${inputType}" → q.type="${fieldType}" | value="${currentVal}" | required=${required}${attrs ? ' | ' + attrs : ''}`);
      }
      questions.push({
        id: fieldId,
        text: label,
        type: fieldType,
        required,
      });
    }

    // Combobox inputs (typeahead — location, language, country pickers)
    const comboboxFields = await modal.locator('input[role="combobox"]').all();
    for (const field of comboboxFields) {
      const fieldId = await field.getAttribute('id');
      if (!fieldId) continue;
      if (!(await field.isVisible().catch(() => false))) continue;
      const label = await this.getLabelForField(field);
      if (!label) continue;
      if (LinkedInApplyEngine.SKIP_LABELS.test(label.trim())) continue;
      if (questions.some(q => q.id === fieldId)) continue; // already collected via text/tel
      questions.push({
        id: fieldId,
        text: label,
        type: 'combobox',
        required: (await field.getAttribute('required')) !== null,
      });
    }

    const selects = await modal.locator('select').all();
    for (const sel of selects) {
      const selId = await sel.getAttribute('id');
      if (!selId) continue; // no real DOM id — fillField can't target it
      if (!(await sel.isVisible().catch(() => false))) continue;
      const label = await this.getLabelForField(sel);
      if (!label) continue;
      if (LinkedInApplyEngine.SKIP_LABELS.test(label.trim())) continue;
      const opts = await sel.locator('option').allInnerTexts();
      questions.push({
        id: selId,
        text: label,
        type: 'select',
        options: opts.filter(o => o.trim()),
        required: (await sel.getAttribute('required')) !== null,
      });
    }

    const fieldsets = await modal.locator('fieldset').all();
    const seenLegends = new Set<string>();
    for (const fieldset of fieldsets) {
      const legend = (await fieldset.locator('legend').first().innerText().catch(() => '')).trim();
      if (!legend || seenLegends.has(legend)) continue;
      seenLegends.add(legend);
      const radios = await fieldset.locator('input[type="radio"]').all();
      if (!radios.length) continue;
      const opts: string[] = [];
      for (const radio of radios) {
        const rid = await radio.getAttribute('id').catch(() => '');
        const optLabel = rid
          ? (await this.page.locator(`label[for="${rid}"]`).innerText().catch(() => '')).trim()
          : (await radio.getAttribute('value').catch(() => '')) ?? '';
        if (optLabel) opts.push(optLabel);
      }
      const firstId = (await radios[0].getAttribute('id').catch(() => '')) ?? `radio_${Date.now()}`;
      questions.push({ id: firstId, text: legend, type: 'radio', options: opts, required: false });
    }

    // Checkboxes — required agreement/consent boxes that block "Next" when unchecked.
    // Collected separately because they need isChecked() not inputValue() logic.
    const checkboxes = await modal.locator('input[type="checkbox"]').all();
    for (const cb of checkboxes) {
      const cbId = await cb.getAttribute('id').catch(() => '');
      if (!cbId) continue;
      if (!(await cb.isVisible().catch(() => false))) continue;
      const alreadyChecked = await cb.isChecked().catch(() => false);
      if (alreadyChecked) continue; // already checked — no action needed
      const label = await this.getLabelForField(cb);
      if (!label) continue;
      questions.push({ id: cbId, text: label, type: 'checkbox', required: true });
    }

    return questions;
  }

  private async fillField(q: QuestionnaireQuestion, value: string): Promise<void> {
    if (q.type === 'text' || q.type === 'textarea' || q.type === 'number' || q.type === 'tel') {
      const el = this.page.locator(`#${q.id}`);
      if (!(await el.waitFor({ state: 'attached', timeout: 800 }).then(() => true).catch(() => false))) {
        console.warn(`[LinkedInApplyEngine] Campo não encontrado: #${q.id} — pulando`);
        return;
      }
      // For tel fields: strip +55 country-code prefix and non-digit separators so the
      // local number (e.g. "11953577804") matches what LinkedIn already pre-fills.
      let fillValue = value;
      if (q.type === 'tel') {
        fillValue = value.replace(/^\+55\s*/, '').replace(/[\s\-\(\)]/g, '');
      }
      // LinkedIn -numeric fields require a raw integer (validation: "Enter a whole number
      // between 0 and 99"). Answers like "8 anos", "15 anos", or long text descriptions
      // must be reduced to just the first integer found. Pure numbers (e.g. "14000" for
      // salary) are already correct and left unchanged.
      if (q.id.includes('numeric') && !/^\d+$/.test(fillValue.trim())) {
        const numMatch = fillValue.match(/\b(\d{1,3})\b/);
        const extracted = numMatch ? numMatch[1] : '0';
        console.log(`[LinkedInApplyEngine] numeric-norm #${q.id.slice(-40)}: "${value.slice(0, 50)}" → "${extracted}"`);
        fillValue = extracted;
      }
      // Skip if field already contains the correct value (avoids unnecessary interaction)
      const rawCurrent = await el.inputValue().catch(() => '');
      const current = rawCurrent.replace(/[\s\-\(\)]/g, '');
      const desired = fillValue.replace(/[\s\-\(\)]/g, '');
      if (current && current === desired) {
        // Diagnostic: log raw value for numeric fields to trace validation failures
        if (q.type === 'number' || q.id.includes('numeric')) {
          console.log(`[LinkedInApplyEngine] #${q.id.slice(-40)} já correto — rawValue="${rawCurrent}" desired="${fillValue}"`);
        } else {
          console.log(`[LinkedInApplyEngine] #${q.id} já correto — pulando`);
        }
        return;
      }
      await this.page.fill(`#${q.id}`, fillValue, { timeout: 3000 });
    } else if (q.type === 'combobox') {
      const el = this.page.locator(`#${q.id}`);
      if (!(await el.waitFor({ state: 'attached', timeout: 800 }).then(() => true).catch(() => false))) {
        console.warn(`[LinkedInApplyEngine] Combobox não encontrado: #${q.id} — pulando`);
        return;
      }
      // Skip if already correctly filled — avoids opening dropdown and risking Enter-submit
      const currentCombo = (await el.inputValue().catch(() => '')).trim();
      if (currentCombo.toLowerCase() === value.trim().toLowerCase()) {
        console.log(`[LinkedInApplyEngine] Combobox #${q.id} já correto — pulando`);
        return;
      }
      await el.click({ timeout: 1500 }).catch(() => {});
      await this.page.fill(`#${q.id}`, value, { timeout: 2000 });
      await delay(600, 800); // wait for dropdown suggestions
      // Check if dropdown is actually open before deciding keyboard action
      const listbox = this.page.locator('[role="listbox"]').first();
      const dropdownOpen = await listbox.isVisible().catch(() => false);
      if (dropdownOpen) {
        const option = this.page.locator('[role="option"], [role="listbox"] li, .basic-typeahead__selectable').first();
        if (await option.isVisible().catch(() => false)) {
          // Click visible option — safest selection method
          await option.click({ timeout: 1500 }).catch(async () => {
            // Option click failed while dropdown IS open → keyboard selection is safe here
            await this.page.keyboard.press('ArrowDown');
            await this.page.keyboard.press('Enter');
          });
        } else {
          // Dropdown open but no options matched — close it
          await this.page.keyboard.press('Escape').catch(() => {});
        }
      } else {
        // No dropdown appeared — Tab to unfocus. NEVER press Enter here: Enter
        // when focus is on a combobox with no open dropdown submits the form.
        await this.page.keyboard.press('Tab').catch(() => {});
      }
    } else if (q.type === 'select') {
      const sel = this.page.locator(`#${q.id}`);
      const ok = await sel.selectOption({ label: value }, { timeout: 1500 }).then(() => true).catch(() => false);
      if (!ok) {
        await sel.selectOption(value, { timeout: 1500 }).catch(async () => {
          const opts = await sel.locator('option').all();
          for (const opt of opts) {
            const txt = (await opt.innerText().catch(() => '')).trim();
            if (txt && txt.toLowerCase().includes(value.toLowerCase().slice(0, 8))) {
              await sel.selectOption({ label: txt }, { timeout: 1000 }).catch(() => {});
              break;
            }
          }
        });
      }
    } else if (q.type === 'checkbox') {
      // Checkboxes are only collected when unchecked — always check them here.
      const cb = this.page.locator(`#${q.id}`);
      if (await cb.count() > 0 && !(await cb.isChecked().catch(() => true))) {
        await cb.check({ force: true, timeout: 2000 }).catch(() => cb.click({ force: true, timeout: 1500 }).catch(() => {}));
        console.log(`[LinkedInApplyEngine] ✓ checkbox #${q.id.slice(-40)} checked`);
      }
    } else if (q.type === 'radio') {
      // Use filter() instead of CSS text-is() interpolation — question text may contain
      // special characters (?  \n  quotes) that break CSS selector parsing (BADSTRING).
      const legendPattern = new RegExp(q.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 60), 'i');
      const fieldset = this.page
        .locator('fieldset')
        .filter({ has: this.page.locator('legend').filter({ hasText: legendPattern }) });
      if (await fieldset.count() > 0) {
        const byLabel = fieldset.first().locator('label').filter({ hasText: new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
        if (await byLabel.count() > 0) { await byLabel.first().click({ force: true }); return; }
        const allRadios = await fieldset.first().locator('input[type="radio"]').all();
        for (const r of allRadios) {
          const v = await r.getAttribute('value').catch(() => '');
          if (v && v.toLowerCase().includes(value.toLowerCase().slice(0, 6))) {
            await r.click({ force: true }); return;
          }
        }
      }
      const radio = this.page.locator(`input[type="radio"][value="${value}"]`);
      if (await radio.count() > 0) await radio.first().click({ force: true });
    }
  }

  private async getLabelForField(field: Locator): Promise<string | null> {
    try {
      const id = await field.getAttribute('id');
      if (id) {
        const label = this.page.locator(`label[for="${id}"]`);
        if (await label.count() > 0) return (await label.first().innerText()).trim();
      }
      return (await field.getAttribute('aria-label')) ?? null;
    } catch { return null; }
  }

  // ── Navegação do formulário ────────────────────────────────────────────────

  private async detectNextAction(tracer: ApplicationTracer): Promise<'next' | 'review' | 'submit' | 'unknown'> {
    const scope = await this.getFormContainer();

    // Use non-anchored patterns so partial accessible names (e.g. "Avaliar candidatura para ...") still match
    const next = scope.getByRole('button', { name: /Next|Próximo|Continue|Continuar|Avançar|Prosseguir/i });
    if (await next.count() > 0 && await next.first().isEnabled().catch(() => false)) return 'next';

    const review = scope.getByRole('button', { name: /Review|Revisar|Avaliar/i });
    if (await review.count() > 0 && await review.first().isEnabled().catch(() => false)) return 'review';

    const submit = scope.getByRole('button', { name: /Submit application|Enviar candidatura|Candidatar-me|Confirmar e enviar/i });
    if (await submit.count() > 0 && await submit.first().isEnabled().catch(() => false)) return 'submit';

    if (await scope.locator('button[aria-label*="Next"], button[aria-label*="Próximo"], button[aria-label*="Avançar"]').count() > 0) return 'next';
    if (await scope.locator('button[aria-label*="Review"], button[aria-label*="Revisar"], button[aria-label*="Avaliar"]').count() > 0) return 'review';
    if (await scope.locator('button[aria-label*="Submit"], button[aria-label*="Enviar candidatura"]').count() > 0) return 'submit';

    const allBtns = await scope.locator('button:visible').all();
    const labels: string[] = [];
    for (const b of allBtns.slice(0, 20)) {
      const txt  = (await b.innerText().catch(() => '')).trim();
      const aria = (await b.getAttribute('aria-label').catch(() => '')) ?? '';
      const lbl  = txt || aria;
      if (lbl) {
        labels.push(lbl);
        if (/review|revisar|avaliar/i.test(lbl)) return 'review';
        if (/avançar|próximo|next|continue|continuar/i.test(lbl)) return 'next';
        if (/enviar candidatura|submit application|candidatar-me|confirmar e enviar/i.test(lbl)) return 'submit';
      }
    }

    // Final fallback: query DOM directly via JS to bypass Playwright's accessibility model.
    // This catches cases where buttons exist in DOM but are not visible/accessible via Playwright selectors.
    try {
      const jsResult = await this.page.evaluate(() => {
        const dialog = document.querySelector('dialog[open]') as HTMLElement | null;
        const root: HTMLElement = dialog ?? document.body;
        for (const btn of Array.from(root.querySelectorAll('button'))) {
          const text = (btn.textContent ?? '').trim();
          if (/avaliar|review|revisar/i.test(text)) return 'review';
          if (/avançar|próximo|next|continuar|continue|prosseguir/i.test(text)) return 'next';
          if (/enviar candidatura|submit application|candidatar-me|confirmar e enviar/i.test(text)) return 'submit';
        }
        return null;
      });
      if (jsResult) {
        tracer.addEvent({ step: 'detect_action_js_fallback', url: this.page.url(), result: 'ok', action: jsResult });
        return jsResult as 'next' | 'review' | 'submit';
      }
    } catch { /* ignore */ }

    tracer.addEvent({ step: 'detect_action_unknown', url: this.page.url(), result: 'error', error: 'Ação desconhecida', metadata: { labels } });
    return 'unknown';
  }

  private async clickNext(tracer: ApplicationTracer): Promise<void> {
    const scope = await this.getFormContainer();
    const btn = scope.getByRole('button', { name: /Next|Próximo|Continue|Continuar|Avançar|Prosseguir|Review|Revisar|Avaliar/i });
    if (await btn.count() > 0) {
      await this.safeClick(btn.first(), tracer, 'click_next');
      return;
    }
    const fallback = scope.locator('button[aria-label*="Next"], button[aria-label*="Próximo"], button[aria-label*="Continue"], button[aria-label*="Avançar"], button[aria-label*="Review"], button[aria-label*="Avaliar"]');
    if (await fallback.count() > 0) {
      await this.safeClick(fallback.first(), tracer, 'click_next_fallback');
      return;
    }
    const all = await scope.locator('button:visible').all();
    for (const b of all.slice(0, 12)) {
      const txt  = (await b.innerText().catch(() => '')).trim();
      const aria = (await b.getAttribute('aria-label').catch(() => '')) ?? '';
      const lbl  = txt || aria;
      if (!lbl || /cancel|fechar|close|dismiss|descartar|sair/i.test(lbl)) continue;
      if (/avançar|próximo|next|continue|continuar|review|revisar|avaliar/i.test(lbl)) {
        await this.safeClick(b, tracer, `click_next_last_resort:${lbl.slice(0, 30)}`);
        return;
      }
    }
  }

  private async submitForm(evidence: EvidenceCollector, tracer: ApplicationTracer): Promise<void> {
    const scope = await this.getFormContainer();
    const btn = scope.getByRole('button', { name: /^(Submit application|Enviar candidatura|Candidatar-me|Confirmar e enviar)$/i });

    if (await btn.count() > 0) {
      await this.safeClick(btn.first(), tracer, 'submit_primary');
    } else {
      const fb = scope.locator('button[aria-label*="Submit"], button[aria-label*="Enviar candidatura"], button[aria-label*="Candidatar"]');
      if (await fb.count() > 0) {
        await this.safeClick(fb.first(), tracer, 'submit_fallback');
      } else {
        await evidence.captureHtml(this.page, 'error_no_submit_btn');
        throw new Error('Botão submit não encontrado no formulário');
      }
    }

    await delay(2000, 3000);
    await this.dismissSaveModal();

    // Fecha confirmação se aparecer
    const dismiss = this.page.getByRole('button', { name: /dismiss|fechar|close/i });
    if (await dismiss.count() > 0) await dismiss.first().click().catch(() => {});
  }

  // ── Modais de sistema ──────────────────────────────────────────────────────

  private async dismissSaveModal(): Promise<void> {
    // Only targets the "save your application?" confirmation popup — NOT the Easy Apply form.
    // The save popup has "Não salvar"/"Dispensar" buttons and no form fields.
    // The Easy Apply modal has form fields (input/select/textarea) and a "Fechar" (×) close
    // button — we must never click that or press Escape, as it would close the apply flow.
    const saveTexts = /salvar (esta )?candidatura|candidatura salva|save (this )?application|application saved/;
    // Dismiss selectors intentionally exclude button[aria-label*="Fechar"] (the Easy Apply ×)
    const dismissSels = [
      'button:has-text("Não salvar")',
      'button:has-text("Dispensar")',
      'button[aria-label*="Dispensar"]',
      '[data-test-modal-close-btn]',
    ];

    try {
      const dialogs = await this.page.locator('div[role="dialog"]').all();
      for (const dialog of dialogs) {
        if (!(await dialog.isVisible().catch(() => false))) continue;
        // Skip the Easy Apply form itself — it always has input/select/textarea fields
        const hasFormFields = (await dialog.locator('input, select, textarea').count().catch(() => 1)) > 0;
        if (hasFormFields) continue;
        const text = (await dialog.innerText().catch(() => '')).toLowerCase();
        if (!saveTexts.test(text)) continue;
        for (const dSel of dismissSels) {
          const btn = dialog.locator(dSel).first();
          if ((await btn.count().catch(() => 0)) > 0 && await btn.isVisible().catch(() => false)) {
            await btn.click({ timeout: 3000 }).catch(() => {});
            await this.page.waitForTimeout(800);
            return;
          }
        }
        // No Escape fallback — it would close the Easy Apply modal
      }
    } catch { /* nunca travar o fluxo */ }
  }

  private async handleAbandonModal(): Promise<void> {
    try {
      const modal = this.page.locator('div[role="dialog"]:has-text("Descartar")');
      if (await modal.count() === 0) return;
      const btn = modal.locator('button:has-text("Descartar")');
      if (await btn.count() > 0) { await btn.click(); await this.page.waitForTimeout(800); }
    } catch { /* ignore */ }
  }

  // ── Utilitários ─────────────────────────────────────────────────────────────

  private async getFormContainer(): Promise<Locator> {
    // Use a short timeout regardless of URL — if the modal is present it resolves
    // immediately; waiting longer wastes time inside the 12s Easy Apply session window.
    await this.page.waitForSelector(MODAL_SEL, { timeout: 800, state: 'attached' }).catch(() => {});
    const container = this.page.locator(MODAL_SEL).first();
    if (await container.count() > 0) return container;
    return this.page.locator('body');
  }

  private async safeClick(locator: Locator, tracer: ApplicationTracer, step: string): Promise<void> {
    try {
      await locator.click({ timeout: 5000 });
      tracer.addEvent({ step, url: this.page.url(), result: 'ok' });
    } catch {
      await locator.dispatchEvent('click');
      tracer.addEvent({ step: `${step}_dispatch`, url: this.page.url(), result: 'ok' });
    }
  }

  private isPostSubmitUrl(url: string): boolean {
    // LinkedIn adds trackingId= to all job view URLs — do NOT use it as a signal.
    // Only match genuine post-apply redirect destinations.
    if (/\/my-items|\/mynetwork/.test(url)) return true;
    // /jobs/? without /view/ is the jobs search page, a real redirect target post-apply.
    if (/\/jobs\/\?/.test(url) && !url.includes('/view/')) return true;
    return false;
  }
}
