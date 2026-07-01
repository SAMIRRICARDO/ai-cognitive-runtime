// packages/work/src/engine/apply.ts

import { Page, Locator } from 'playwright';
import { QuestionnaireQuestion } from '../types/index.js';

const delay = (min: number, max: number) =>
  new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));

export interface ApplyOptions {
  resumePath: string;
  coverLetterPath?: string;
  onQuestion: (q: QuestionnaireQuestion) => Promise<string>;
  dryRun?: boolean;
}

const MODAL_SEL = [
  '[data-test-modal-id="easy-apply-modal"]',
  '.jobs-easy-apply-modal',
  '[data-test-modal-container]',
  '.artdeco-modal--layer-default',
  '[role="dialog"]',
].join(', ');

export class EasyApplyEngine {
  constructor(private page: Page) {}

  private async getFormContainer(): Promise<Locator> {
    // Aguarda o modal aparecer no DOM (attached é suficiente — pode ter aria-hidden durante transição)
    await this.page.waitForSelector(MODAL_SEL, { timeout: 8000, state: 'attached' }).catch(() => {});
    const container = this.page.locator(MODAL_SEL).first();
    if (await container.count() > 0) return container;
    console.warn(`[Apply] Modal não encontrado — scope: body. URL: ${this.page.url().slice(0, 60)}`);
    return this.page.locator('body');
  }

  async apply(linkedinUrl: string, options: ApplyOptions): Promise<boolean> {
    if (options.dryRun) {
      console.log('[Apply] DRY RUN — candidatura simulada (não submetida).');
      return true;
    }

    // ── Navega apenas se a página não está já no job correto ──────────────────
    const jobId = linkedinUrl.match(/\/jobs\/view\/(\d+)/)?.[1];
    const alreadyOnPage = jobId && this.page.url().includes(jobId);

    if (!alreadyOnPage) {
      try {
        await this.page.goto(linkedinUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      } catch {
        await this.page.goto(linkedinUrl, { waitUntil: 'commit', timeout: 30000 }).catch(() => {});
      }
    }

    // Scroll ao topo — scrapeJobDescription pode ter scrollado a página
    await this.page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await delay(1200, 2500);

    // ── Detecção do botão Easy Apply ──────────────────────────────────────────
    const applyBtn = await this.findEasyApplyButton();

    if (!applyBtn) {
      await this.logAvailableButtons();
      return false;
    }

    const urlBeforeClick = this.page.url();
    await applyBtn.click();

    // ── Detecta modo de candidatura (página ou modal) ────────────────────────
    // Aguarda navegação ou abertura do modal (até 4s)
    await delay(2500, 4000);
    const urlAfterClick = this.page.url();

    if (!urlAfterClick.includes('linkedin.com')) {
      console.warn(`[Apply] Redirect externo: ${urlAfterClick.slice(0, 80)}`);
      await this.page.goBack().catch(() => {});
      return false;
    }

    const isPageFlow = urlAfterClick.includes('/apply');

    if (isPageFlow) {
      console.log(`[Apply] Fluxo via página: ${urlAfterClick.slice(0, 80)}`);
      // Aguarda o formulário renderizar (formulário está no painel direito — precisa de tempo extra)
      await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      await delay(3000, 4000);
    } else {
      // Tenta detectar modal (fluxo antigo)
      const modalOpened = await this.page
        .locator('[role="dialog"], .jobs-easy-apply-modal, .artdeco-modal')
        .first()
        .waitFor({ state: 'visible', timeout: 8000 })
        .then(() => true)
        .catch(() => false);

      if (!modalOpened) {
        const bodyText = await this.page.locator('body').innerText().catch(() => '');
        if (/you.ve applied|candidatura enviada|já se candidatou/i.test(bodyText)) {
          console.log('[Apply] Candidatura já enviada anteriormente.');
          return true;
        }
        console.warn(`[Apply] Modal não abriu. URL: ${urlAfterClick.slice(0, 80)}`);
        console.warn(`[Apply] Título: ${await this.page.title().catch(() => '?')}`);
        return false;
      }
      console.log('[Apply] Fluxo via modal.');
    }

    // ── Preenche o formulário passo a passo ───────────────────────────────────
    let stepCount = 0;
    const maxSteps = 10;

    // Detecta redirect pós-candidatura: URL saiu de /apply → /jobs/view/?trackingId=
    const checkApplyRedirect = (label: string): boolean => {
      const url = this.page.url();
      if (isPageFlow && !url.includes('/apply')) {
        if (url.includes('trackingId=')) {
          console.log(`[Apply] ✅ Candidatura submetida — ${label} (redirect com trackingId).`);
          return true;
        }
        console.warn(`[Apply] URL saiu do fluxo apply (${label}): ${url.slice(0, 80)}`);
      }
      return false;
    };

    while (stepCount < maxSteps) {
      stepCount++;
      const stepUrl = this.page.url();
      console.log(`[Apply] Step ${stepCount} URL: ${stepUrl.slice(0, 80)}`);

      // Candidatura pode ter sido submetida durante o delay/load anterior
      if (checkApplyRedirect(`início step ${stepCount}`)) return true;

      // Fecha qualquer dropdown/search aberto que possa interceptar cliques
      await this.page.keyboard.press('Escape').catch(() => {});
      await delay(300, 500);

      await this.handleFileUpload(options.resumePath, options.coverLetterPath);
      await this.handleQuestions(options.onQuestion);

      // Formulário de campo único pode auto-submeter ao preencher
      if (checkApplyRedirect('pós-questionário')) return true;

      const action = await this.detectNextAction();
      console.log(`[Apply] Ação detectada: ${action}`);

      if (action === 'submit') {
        await this.submit();
        return true;
      }

      if (action === 'next' || action === 'review') {
        await this.clickNext();
        await this.page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
        await delay(1500, 2500);
        // "Avançar" em formulário de 1 passo = submit disfarçado
        if (checkApplyRedirect('pós-avançar')) return true;
        continue;
      }

      console.warn('[Apply] Estado desconhecido no modal — encerrando.');
      break;
    }

    return false;
  }

  // ── Estratégias de detecção do botão Easy Apply ────────────────────────────

  private async findEasyApplyButton(): Promise<Locator | null> {
    // ── Estratégia 1: "Candidatura simplificada" (PT-BR) ─────────────────────
    // exact:false permite match parcial (aria-name pode ser "Candidatura simplificada para X")
    const ptBtn = this.page.getByRole('button', { name: 'Candidatura simplificada' });
    if (await ptBtn.count() > 0 && await ptBtn.first().isVisible().catch(() => false)) {
      console.log('[Apply] Botão: "Candidatura simplificada"');
      return ptBtn.first();
    }

    // ── Estratégia 2: botão primário artdeco--primary com texto candidatura ──
    const primaryAll = await this.page.locator('button.artdeco-button--primary').all();
    for (const btn of primaryAll) {
      const txt = (await btn.innerText().catch(() => '')).trim();
      if (/Candidatura simplificada|Easy Apply/i.test(txt)) {
        const isVis = await btn.isVisible().catch(() => false);
        if (isVis) {
          console.log(`[Apply] Botão primário: "${txt}"`);
          return btn;
        }
      }
    }

    // ── Estratégia 3: aria-label ──────────────────────────────────────────────
    const byAriaLabel = this.page.locator([
      'button[aria-label*="Candidatura simplificada"]',
      'button[aria-label*="Easy Apply"]',
    ].join(', '));
    if (await byAriaLabel.count() > 0 && await byAriaLabel.first().isVisible().catch(() => false)) {
      const aria = await byAriaLabel.first().getAttribute('aria-label').catch(() => '');
      console.log(`[Apply] Botão via aria-label: "${aria}"`);
      return byAriaLabel.first();
    }

    // ── Estratégia 4: getByRole com regex (fallback EN) ───────────────────────
    const enBtn = this.page.getByRole('button', { name: 'Easy Apply', exact: true });
    if (await enBtn.count() > 0 && await enBtn.first().isVisible().catch(() => false)) {
      console.log('[Apply] Botão: "Easy Apply" (exact EN)');
      return enBtn.first();
    }

    // ── Estratégia 5: seletores estruturais do LinkedIn ───────────────────────
    const byStructure = this.page.locator([
      'button[data-live-test-easy-apply-button]',
      '[data-control-name="jobdetails_topcard_inapply"]',
      '.jobs-apply-button--top-card button',
      '.jobs-s-apply button',
      '.jobs-unified-top-card__cta-container button.artdeco-button--primary',
      '.job-details-jobs-unified-top-card__cta-container button',
    ].join(', '));
    if (await byStructure.count() > 0 && await byStructure.first().isVisible().catch(() => false)) {
      const txt = (await byStructure.first().innerText().catch(() => '')).trim();
      console.log(`[Apply] Botão estrutural: "${txt}"`);
      return byStructure.first();
    }

    return null;
  }

  private async logAvailableButtons(): Promise<void> {
    try {
      const allBtns = await this.page.locator('button:visible').all();
      const labels: string[] = [];
      for (const btn of allBtns.slice(0, 8)) {
        const aria = await btn.getAttribute('aria-label').catch(() => '');
        const txt  = await btn.innerText().catch(() => '');
        const cls  = await btn.getAttribute('class').catch(() => '');
        labels.push(`[${(aria || txt || cls || '?').slice(0, 60)}]`);
      }
      console.warn(`[Apply] Botão Easy Apply não encontrado. URL: ${this.page.url().slice(0, 80)}`);
      console.warn(`[Apply] Botões visíveis: ${labels.join(', ')}`);
    } catch {
      console.warn('[Apply] Botão Easy Apply não encontrado.');
    }
  }

  // ── Upload de arquivo ──────────────────────────────────────────────────────

  private async handleFileUpload(resumePath: string, coverLetterPath?: string): Promise<void> {
    const resumeInput = this.page.locator([
      'input[type="file"][name*="resume"]',
      'input[type="file"][id*="resume"]',
      'input[type="file"][accept*="pdf"]',
    ].join(', '));
    if (await resumeInput.count() > 0) {
      await resumeInput.first().setInputFiles(resumePath);
      await delay(500, 1000);
      console.log('[Apply] Resume enviado.');
    }

    if (coverLetterPath) {
      const clInput = this.page.locator('input[type="file"][name*="cover"], input[type="file"][id*="cover"]');
      if (await clInput.count() > 0) {
        await clInput.first().setInputFiles(coverLetterPath);
        await delay(500, 1000);
      }
    }
  }

  // ── Coleta e preenchimento de perguntas ───────────────────────────────────

  async collectQuestions(): Promise<QuestionnaireQuestion[]> {
    const questions: QuestionnaireQuestion[] = [];
    // Usa a página inteira — funciona com fluxo via página /apply/ e via modal
    const modal = this.page.locator('body');

    const textFields = await modal.locator('input[type="text"], input[type="number"], textarea').all();
    for (const field of textFields) {
      const label = await this.getLabelForField(field);
      if (!label) continue;
      const tagName = await field.evaluate((el: Element) => el.tagName.toLowerCase());
      questions.push({
        id: (await field.getAttribute('id')) ?? `q_${Date.now()}`,
        text: label,
        type: tagName === 'textarea' ? 'textarea' : 'text',
        required: (await field.getAttribute('required')) !== null,
      });
    }

    const selects = await modal.locator('select').all();
    for (const sel of selects) {
      const label = await this.getLabelForField(sel);
      if (!label) continue;
      const opts = await sel.locator('option').allInnerTexts();
      questions.push({
        id: (await sel.getAttribute('id')) ?? `q_${Date.now()}`,
        text: label,
        type: 'select',
        options: opts.filter(o => o.trim()),
        required: (await sel.getAttribute('required')) !== null,
      });
    }

    return questions;
  }

  private async handleQuestions(onQuestion: (q: QuestionnaireQuestion) => Promise<string>): Promise<void> {
    const questions = await this.collectQuestions();
    for (const q of questions) {
      const answer = await onQuestion(q);
      if (!answer) continue;
      try {
        await this.fillField(q, answer);
        await delay(200, 500);
      } catch (err) {
        console.warn(`[Apply] Erro ao preencher "${q.text}":`, err);
      }
    }
  }

  private async fillField(q: QuestionnaireQuestion, value: string): Promise<void> {
    if (q.type === 'text' || q.type === 'textarea') {
      const el = this.page.locator(`#${q.id}`);
      const exists = await el.waitFor({ state: 'attached', timeout: 2000 }).then(() => true).catch(() => false);
      if (!exists) {
        console.warn(`[Apply] Campo não encontrado: #${q.id} ("${q.text}") — pulando`);
        return;
      }
      await this.page.fill(`#${q.id}`, value, { timeout: 6000 });
    } else if (q.type === 'select') {
      // Try by label, then by value, then by partial text match — all with short timeout
      const sel = this.page.locator(`#${q.id}`);
      const matched = await sel.selectOption({ label: value }, { timeout: 4000 })
        .then(() => true).catch(() => false);
      if (!matched) {
        await sel.selectOption(value, { timeout: 4000 })
          .catch(async () => {
            // Last resort: find option whose text contains the value
            const opts = await sel.locator('option').all();
            for (const opt of opts) {
              const txt = (await opt.innerText().catch(() => '')).trim();
              if (txt && txt.toLowerCase().includes(value.toLowerCase().slice(0, 8))) {
                await sel.selectOption({ label: txt }, { timeout: 3000 }).catch(() => {});
                break;
              }
            }
          });
      }
    } else if (q.type === 'radio') {
      const radio = this.page.locator(`input[type="radio"][value="${value}"]`);
      if (await radio.count() > 0) await radio.first().click();
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
    } catch {
      return null;
    }
  }

  // ── Navegação no modal ────────────────────────────────────────────────────

  private async detectNextAction(): Promise<'next' | 'review' | 'submit' | 'unknown'> {
    // Busca dentro do container do formulário (modal ou página)
    const scope = await this.getFormContainer();

    const submit = scope.getByRole('button', {
      name: /Submit application|Enviar candidatura|Candidatar-me|Confirmar e enviar|Submit|Enviar/i,
    });
    if (await submit.count() > 0 && await submit.first().isEnabled()) return 'submit';

    const review = scope.getByRole('button', { name: /^(Review|Revisar)$/i });
    if (await review.count() > 0) return 'review';

    const next = scope.getByRole('button', {
      name: /Next|Próximo|Continue|Continuar|Avançar|Prosseguir|Próxima|Próximo passo/i,
    });
    if (await next.count() > 0) return 'next';

    // Fallback aria-label (scoped)
    if (await scope.locator('button[aria-label*="Submit"], button[aria-label*="Enviar candidatura"]').count() > 0) return 'submit';
    if (await scope.locator('button[aria-label*="Review"], button[aria-label*="Revisar"]').count() > 0) return 'review';
    if (await scope.locator('button[aria-label*="Next"], button[aria-label*="Próximo"], button[aria-label*="Continue"], button[aria-label*="Avançar"]').count() > 0) return 'next';

    // Last resort: qualquer botão visível dentro do container
    const allBtns = await scope.locator('button:visible').all();
    const labels: string[] = [];
    for (const b of allBtns.slice(0, 20)) {
      const txt = (await b.innerText().catch(() => '')).trim();
      const aria = await b.getAttribute('aria-label').catch(() => '') ?? '';
      const label = txt || aria;
      if (label) labels.push(label);
    }
    if (labels.length > 0) {
      console.warn(`[Apply] Botões no formulário: ${labels.join(' | ')}`);
      for (const label of labels) {
        if (/enviar|submit|candidatar|confirmar/i.test(label)) return 'submit';
        if (/avançar|próximo|next|continue|continuar|review|revisar/i.test(label)) return 'next';
      }
    }

    return 'unknown';
  }

  private async clickAndFallback(locator: Locator): Promise<void> {
    try {
      await locator.click({ timeout: 5000 });
    } catch {
      console.warn('[Apply] Click bloqueado — usando dispatchEvent');
      await locator.dispatchEvent('click');
    }
  }

  private async clickNext(): Promise<void> {
    const scope = await this.getFormContainer();

    const btn = scope.getByRole('button', {
      name: /Next|Próximo|Continue|Continuar|Avançar|Prosseguir|Review|Revisar/i,
    });
    if (await btn.count() > 0) {
      await this.clickAndFallback(btn.first());
      return;
    }
    const fallback = scope.locator(
      'button[aria-label*="Next"], button[aria-label*="Próximo"], ' +
      'button[aria-label*="Continue"], button[aria-label*="Avançar"], button[aria-label*="Review"]'
    );
    if (await fallback.count() > 0) {
      await this.clickAndFallback(fallback.first());
      return;
    }
    // Last resort: qualquer botão de ação dentro do formulário
    const allBtns = await scope.locator('button:visible').all();
    for (const b of allBtns.slice(0, 12)) {
      const txt = (await b.innerText().catch(() => '')).trim();
      const aria = await b.getAttribute('aria-label').catch(() => '') ?? '';
      const label = txt || aria;
      if (!label || /cancel|fechar|close|dismiss|descartar|sair/i.test(label)) continue;
      if (/avançar|próximo|next|continue|continuar|review|revisar/i.test(label)) {
        console.log(`[Apply] Clicando fallback: "${label}"`);
        await this.clickAndFallback(b);
        return;
      }
    }
  }

  private async submit(): Promise<void> {
    const scope = await this.getFormContainer();
    const btn = scope.getByRole('button', {
      name: /Submit application|Enviar candidatura|Candidatar-me|Confirmar e enviar|Submit|Enviar/i,
    });
    if (await btn.count() > 0) {
      await this.clickAndFallback(btn.first());
    } else {
      const fallback = scope.locator(
        'button[aria-label*="Submit"], button[aria-label*="Enviar candidatura"], ' +
        'button[aria-label*="Candidatar"]'
      );
      if (await fallback.count() > 0) await this.clickAndFallback(fallback.first());
    }
    await delay(2000, 3000);

    // Fecha confirmação se aparecer
    const dismiss = this.page.getByRole('button', { name: /dismiss|fechar|close/i });
    if (await dismiss.count() > 0) await dismiss.first().click();

    console.log('[Apply] ✅ Aplicação submetida.');
  }
}
