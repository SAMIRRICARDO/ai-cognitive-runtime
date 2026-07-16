// packages/work/src/application/ValidationEngine.ts
// Valida se uma candidatura foi REALMENTE enviada via múltiplas heurísticas.
// Nunca depende apenas do fechamento do modal.

import { Page } from 'playwright';
import { ValidationResult, NetworkRequest } from './types.js';
import { EvidenceCollector } from './EvidenceCollector.js';

const MY_JOBS_URL = 'https://www.linkedin.com/my-items/saved-jobs/?cardType=APPLIED';

const CONFIRMATION_PATTERNS = [
  /candidatura enviada/i,
  /application submitted/i,
  /you.ve applied/i,
  /já se candidatou/i,
  /your application was sent/i,
  /application received/i,
  /candidatura recebida/i,
  /successfully applied/i,
  /sua candidatura foi enviada/i,
];

// Endpoints do LinkedIn que indicam submit bem-sucedido
const SUBMIT_ENDPOINT_PATTERNS = [
  /\/voyager\/api\/jobs\/.*\/easyApplyApplications/i,
  /\/jobs\/applyWithUnifiedProcess/i,
  /\/jobs\/easyApply/i,
  /applyApplication/i,
];

export class ValidationEngine {
  async validate(
    page: Page,
    jobId: string,
    networkRequests: NetworkRequest[],
    evidence: EvidenceCollector,
  ): Promise<ValidationResult> {
    console.log(`[Validation:${jobId}] Iniciando validação com ${networkRequests.length} requisições capturadas`);

    // ── Prioridade 1: Interceptação de rede (confiança máxima) ────────────────
    const netResult = this.checkNetworkResponses(networkRequests);
    if (netResult.confirmed) {
      console.log(`[Validation:${jobId}] ✅ Confirmado via rede: ${netResult.details}`);
      return netResult;
    }

    // ── Prioridade 2: Verificar LinkedIn My Jobs > Applied ────────────────────
    const myJobsResult = await this.checkMyJobsApplied(page, jobId, evidence);
    if (myJobsResult.confirmed) {
      console.log(`[Validation:${jobId}] ✅ Confirmado via My Jobs: ${myJobsResult.details}`);
      return myJobsResult;
    }

    // ── Prioridade 3: Estado da página + texto de confirmação ─────────────────
    const pageResult = await this.checkPageState(page, evidence);
    if (pageResult.confirmed) {
      console.log(`[Validation:${jobId}] ✅ Confirmado via página: ${pageResult.details}`);
      return pageResult;
    }

    console.warn(`[Validation:${jobId}] ⚠️ Nenhuma evidência de confirmação encontrada`);
    return {
      confirmed: false,
      method: 'none',
      confidence: 'low',
      details: 'Nenhum dos métodos de validação confirmou o envio',
    };
  }

  // ── Rede ───────────────────────────────────────────────────────────────────

  private checkNetworkResponses(requests: NetworkRequest[]): ValidationResult {
    const hit = requests.find(r =>
      r.isApplicationRelated &&
      r.method === 'POST' &&
      r.status >= 200 && r.status < 300 &&
      SUBMIT_ENDPOINT_PATTERNS.some(p => p.test(r.url)),
    );

    if (hit) {
      return {
        confirmed: true,
        method: 'network_response',
        confidence: 'high',
        details: `POST ${hit.url.slice(0, 80)} → HTTP ${hit.status}`,
        evidence: { url: hit.url, status: hit.status, timestamp: hit.timestamp },
      };
    }

    return { confirmed: false, method: 'none', confidence: 'low', details: '' };
  }

  // ── My Jobs ────────────────────────────────────────────────────────────────

  private async checkMyJobsApplied(
    page: Page,
    jobId: string,
    evidence: EvidenceCollector,
  ): Promise<ValidationResult> {
    let priorUrl: string | null = null;
    try {
      priorUrl = page.url();
      await page.goto(MY_JOBS_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(2500);
      await evidence.captureScreenshot(page, 'my_jobs_check');

      // Verifica jobId na URL de algum card ou no DOM
      const jobOnPage =
        (await page.locator(`[data-job-id="${jobId}"]`).count()) > 0 ||
        (await page.locator(`a[href*="${jobId}"]`).count()) > 0;

      if (jobOnPage) {
        return {
          confirmed: true,
          method: 'my_jobs_applied',
          confidence: 'high',
          details: `Job ${jobId} encontrado na lista My Jobs > Applied`,
          evidence: { jobId, checkedAt: new Date().toISOString() },
        };
      }
    } catch (err) {
      console.warn(`[Validation] My Jobs check falhou: ${String(err).slice(0, 100)}`);
    } finally {
      if (priorUrl) {
        await page.goto(priorUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      }
    }

    return { confirmed: false, method: 'none', confidence: 'low', details: '' };
  }

  // ── Estado da Página ───────────────────────────────────────────────────────

  private async checkPageState(page: Page, evidence: EvidenceCollector): Promise<ValidationResult> {
    try {
      const url = page.url();
      await evidence.captureScreenshot(page, 'post_submit');
      const bodyText = await page.locator('body').innerText().catch(() => '');

      // trackingId no redirect = candidatura enviada com sucesso
      if (url.includes('trackingId=')) {
        return {
          confirmed: true,
          method: 'page_transition',
          confidence: 'medium',
          details: `Redirect pós-candidatura com trackingId: ${url.slice(0, 120)}`,
          evidence: { url },
        };
      }

      // Texto de confirmação na página
      for (const pattern of CONFIRMATION_PATTERNS) {
        if (pattern.test(bodyText)) {
          return {
            confirmed: true,
            method: 'confirmation_text',
            confidence: 'medium',
            details: `Texto de confirmação detectado (padrão: /${pattern.source}/)`,
            evidence: { url, matchedPattern: pattern.source },
          };
        }
      }
    } catch { /* ignore — não bloquear o fluxo */ }

    return { confirmed: false, method: 'none', confidence: 'low', details: '' };
  }
}
