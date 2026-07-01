// packages/work/src/engine/catho.ts
// Motor Catho — busca + candidatura com paridade LinkedIn

import type { Page, Locator } from 'playwright';
import path from 'path';
import fs from 'fs';
import type { CathoJob, CathoSearchConfig, QuestionnaireQuestion } from '../types/index.js';

const delay = (min: number, max: number) =>
  new Promise<void>(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));

const SESSION_DIR  = path.resolve(process.cwd(), '.vraxia-work', 'catho-session');
const COOKIES_PATH = path.join(SESSION_DIR, 'cookies.json');

// ─── CathoSession ─────────────────────────────────────────────────────────────

export class CathoSession {
  constructor(private page: Page) {}

  async login(): Promise<boolean> {
    fs.mkdirSync(SESSION_DIR, { recursive: true });

    if (fs.existsSync(COOKIES_PATH)) {
      const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
      await this.page.context().addCookies(cookies);
      await this.page.goto('https://www.catho.com.br', { waitUntil: 'domcontentloaded' });
      await delay(1500, 2500);
      if (await this.isLoggedIn()) {
        console.log('[Catho] Sessão restaurada via cookie.');
        return true;
      }
      console.log('[Catho] Cookies expirados — fazendo login Google...');
    }

    await this.page.goto('https://www.catho.com.br/area-candidato/login/', { waitUntil: 'domcontentloaded' });
    await delay(1500, 3000);

    const googleBtnSel = [
      'button:has-text("Entrar com Google")',
      'a:has-text("Entrar com Google")',
      'button:has-text("Google")',
      '[aria-label*="Google"]',
    ].join(', ');

    if (await this.page.locator(googleBtnSel).count() === 0) {
      console.error('[Catho] Botão Google não encontrado na página de login.');
      return false;
    }

    // Google OAuth abre popup — escutamos antes de clicar
    let popup: Page | null = null;
    const waitForPopup = this.page.context()
      .waitForEvent('page', { timeout: 15000 })
      .then(p => { popup = p; })
      .catch(() => {});

    await this.page.locator(googleBtnSel).first().click();
    await waitForPopup;
    await delay(1500, 2500);

    const oauthPage: Page = popup ?? this.page;

    if (await oauthPage.locator('input[type="email"]').count() > 0) {
      await oauthPage.fill('input[type="email"]', 'eliteasamir@gmail.com');
      await delay(500, 900);
      await oauthPage.locator('#identifierNext, button:has-text("Next"), button:has-text("Próximo")').first().click();
      await delay(1500, 2500);

      await oauthPage.waitForSelector('input[type="password"]', { timeout: 10000 }).catch(() => {});
      if (await oauthPage.locator('input[type="password"]').count() > 0) {
        await oauthPage.fill('input[type="password"]', process.env.GOOGLE_PASSWORD ?? '');
        await delay(500, 900);
        await oauthPage.locator('#passwordNext, button:has-text("Next"), button:has-text("Próximo")').first().click();
        await delay(3000, 5000);
      }
    }

    // Aguarda redirect de volta ao Catho
    try {
      await this.page.waitForURL('**catho.com.br**', { timeout: 30000 });
    } catch {
      console.warn('[Catho] Timeout aguardando redirect — verificando estado atual...');
    }
    await delay(2000, 3000);

    if (await this.isLoggedIn()) {
      await this.saveCookies();
      console.log('[Catho] Login Google bem-sucedido. Cookies salvos.');
      return true;
    }

    // Pode precisar de 2FA manual
    console.warn('[Catho] Verificação adicional necessária (2FA/CAPTCHA) — aguardando 60s...');
    try {
      await this.page.waitForURL('**catho.com.br**', { timeout: 60000 });
      await delay(2000, 3000);
      if (await this.isLoggedIn()) {
        await this.saveCookies();
        return true;
      }
    } catch { /* timeout */ }

    return false;
  }

  private async isLoggedIn(): Promise<boolean> {
    const url = this.page.url();
    if (url.includes('/area-candidato/') && !url.includes('/login/')) return true;
    const indicators = [
      'a[href*="meu-perfil"]',
      'a[href*="minha-conta"]',
      '[data-testid="user-menu"]',
      '[data-testid="candidate-menu"]',
      '.sc-candidate-name',
    ].join(', ');
    return (await this.page.locator(indicators).count()) > 0;
  }

  private async saveCookies(): Promise<void> {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    const cookies = await this.page.context().cookies();
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  }
}

// ─── CathoSearchEngine ────────────────────────────────────────────────────────

const CARD_SEL = [
  'article[data-testid="job-card"]',
  'div[data-testid="job-card"]',
  'li[class*="JobCard"]',
  'div[class*="JobCard"]',
  'div[class*="job-card"]',
  '[class*="search-result-card"]',
].join(', ');

export class CathoSearchEngine {
  constructor(private page: Page) {}

  async searchJobs(config: CathoSearchConfig): Promise<CathoJob[]> {
    const jobs: CathoJob[] = [];
    const seen = new Set<string>();

    for (const keyword of config.keywords) {
      const url = this.buildUrl(keyword, config);
      console.log(`[Catho] Buscando: ${url}`);

      try {
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch {
        console.warn(`[Catho] Timeout ao carregar "${keyword}" — pulando.`);
        continue;
      }
      await delay(2000, 3500);
      await this.scrollAndLoadMore();

      const cards = this.page.locator(CARD_SEL);
      const count = await cards.count();
      console.log(`[Catho] ${count} cards para "${keyword}"`);

      for (let i = 0; i < count; i++) {
        try {
          const job = await this.extractCard(cards.nth(i));
          if (!job || seen.has(job.id)) continue;
          seen.add(job.id);
          if (this.isBlacklisted(job.title, config.titleBlacklist ?? [])) continue;
          jobs.push(job);
        } catch { /* card malformado */ }
      }

      await delay(2000, 4000);
    }

    return jobs;
  }

  async scrapeJobDescription(jobUrl: string): Promise<string> {
    try {
      await this.page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch {
      return '';
    }
    await delay(1500, 2500);

    const showMore = this.page.locator('button:has-text("Ver mais"), [data-testid="show-more"]');
    if (await showMore.count() > 0) await showMore.first().click().catch(() => {});

    const descSel = [
      'section[data-testid="job-description"]',
      'div[data-testid="job-description"]',
      '[class*="description"]',
      '[class*="jobDescription"]',
      '[class*="job-description"]',
    ].join(', ');

    const el = this.page.locator(descSel).first();
    if (await el.count() > 0) return (await el.innerText()).trim();
    return '';
  }

  private buildUrl(keyword: string, config: CathoSearchConfig): string {
    const params = new URLSearchParams({ q: keyword });
    if (config.location)      params.set('where', config.location);
    if (config.remote)        params.set('tipo-trabalho', 'home-office');
    if (config.contractType)  params.set('contract', String(config.contractType));
    return `https://www.catho.com.br/vagas/?${params.toString()}`;
  }

  private async scrollAndLoadMore(): Promise<void> {
    let lastH = 0;
    for (let i = 0; i < 6; i++) {
      const h: number = await this.page.evaluate(() => document.body.scrollHeight);
      if (h === lastH) break;
      lastH = h;
      await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await delay(1200, 2000);

      const loadMore = this.page.locator(
        'button:has-text("Ver mais vagas"), button:has-text("Carregar mais"), [data-testid="load-more"]'
      );
      if (await loadMore.count() > 0) {
        await loadMore.first().click().catch(() => {});
        await delay(1500, 2500);
      }
    }
  }

  private async extractCard(card: Locator): Promise<CathoJob | null> {
    const titleSel = [
      'h2[data-testid="job-title"]',
      'a[data-testid="job-title"]',
      'h2[class*="title"] a',
      'h3[class*="title"] a',
      '[class*="job-title"] a',
      'a[class*="title"]',
      'h2 a',
      'a[href*="/vagas/"]',
    ].join(', ');

    const titleEl = card.locator(titleSel).first();
    if (await titleEl.count() === 0) return null;

    const title = (await titleEl.innerText()).trim();
    if (!title) return null;

    const href    = (await titleEl.getAttribute('href')) ?? '';
    const fullUrl = href.startsWith('http') ? href : `https://www.catho.com.br${href}`;

    const idMatch = fullUrl.match(/\/vagas\/[^/]+\/(\d+)/) ?? fullUrl.match(/[\/?&](?:id[=\/]?)?(\d{6,})/);
    const jobId   = idMatch?.[1] ?? `t${Date.now().toString(36)}`;

    const companySel = 'span[data-testid="company-name"], [class*="company-name"], [class*="employer"]';
    const compEl     = card.locator(companySel).first();
    const company    = (await compEl.count() > 0) ? (await compEl.innerText()).trim() : 'Empresa confidencial';

    const locSel  = 'span[data-testid="job-location"], [class*="location"], [class*="city"]';
    const locEl   = card.locator(locSel).first();
    const location = (await locEl.count() > 0) ? (await locEl.innerText()).trim() : '';

    const salarySel  = 'span[data-testid="salary"], [class*="salary"], [class*="salario"]';
    const salaryEl   = card.locator(salarySel).first();
    const salaryRange = (await salaryEl.count() > 0) ? (await salaryEl.innerText()).trim() : undefined;

    return {
      id: `catho_${jobId}`,
      cathoJobId: jobId,
      title,
      company,
      location,
      linkedinUrl: fullUrl,
      applicationUrl: fullUrl,
      description: '',
      isEasyApply: true,
      scannedAt: new Date().toISOString(),
      salaryRange,
      platform: 'catho',
    };
  }

  private isBlacklisted(title: string, list: string[]): boolean {
    const lower = title.toLowerCase();
    return list.some(t => lower.includes(t.toLowerCase()));
  }
}

// ─── CathoApplyEngine ─────────────────────────────────────────────────────────

export interface CathoApplyOptions {
  resumePath: string;
  onQuestion: (q: QuestionnaireQuestion) => Promise<string>;
  dryRun?: boolean;
}

export class CathoApplyEngine {
  constructor(private page: Page) {}

  async apply(job: CathoJob, opts: CathoApplyOptions): Promise<boolean> {
    if (opts.dryRun) {
      console.log('[Catho/Apply] DRY RUN — simulando candidatura.');
      return true;
    }

    await this.navigate(job.applicationUrl);
    if (await this.detectCaptcha()) {
      console.warn('[Catho/Apply] CAPTCHA detectado — abortando.');
      return false;
    }

    await this.dismissModals();

    const applyBtnSel = [
      'button[data-testid="apply-button"]',
      'button:has-text("Candidatar-se")',
      'button:has-text("Me candidatar")',
      'button:has-text("Enviar currículo")',
      'button:has-text("Quero me candidatar")',
      'button:has-text("Candidatar")',
      'a:has-text("Candidatar-se")',
    ].join(', ');

    if (await this.page.locator(applyBtnSel).count() === 0) {
      console.warn('[Catho/Apply] Botão de candidatura não encontrado — filtered_out.');
      return false;
    }

    await this.page.locator(applyBtnSel).first().click();
    await delay(1500, 2500);
    await this.dismissModals();

    for (let step = 0; step < 6; step++) {
      console.log(`[Catho/Apply] Step ${step + 1} — ${this.page.url().slice(0, 70)}`);

      if (await this.detectCaptcha()) {
        console.warn('[Catho/Apply] CAPTCHA no step — abortando.');
        return false;
      }

      await this.dismissModals();
      await this.handleFileUpload(opts.resumePath);
      await this.answerQuestions(opts.onQuestion);
      await this.dismissModals();

      const action = await this.detectAction();
      console.log(`[Catho/Apply] Ação: ${action}`);

      if (action === 'submit') {
        await this.submitForm();
        return true;
      }

      if (action === 'next') {
        await this.clickFirst([
          'button[data-testid="next-button"]',
          'button:has-text("Próximo")',
          'button:has-text("Continuar")',
          'button:has-text("Avançar")',
        ]);
        await delay(1500, 2500);
        continue;
      }

      const body = await this.page.locator('body').innerText().catch(() => '');
      if (/candidatura enviada|currículo enviado|obrigado|parabéns/i.test(body)) {
        console.log('[Catho/Apply] ✅ Candidatura confirmada via texto.');
        return true;
      }

      console.warn('[Catho/Apply] Estado desconhecido — encerrando.');
      break;
    }

    return false;
  }

  async collectQuestions(): Promise<QuestionnaireQuestion[]> {
    const qs: QuestionnaireQuestion[] = [];
    const seen = new Set<string>();

    for (const el of await this.page.locator('textarea').all()) {
      if (!await el.isVisible().catch(() => false)) continue;
      const q = await this.buildQ(el, 'textarea');
      if (q && !seen.has(q.id)) { qs.push(q); seen.add(q.id); }
    }

    for (const el of await this.page.locator('input[type="text"], input[type="number"]').all()) {
      if (!await el.isVisible().catch(() => false)) continue;
      if (await el.inputValue().catch(() => '')) continue;
      const type = (await el.getAttribute('type')) === 'number' ? 'number' : 'text';
      const q = await this.buildQ(el, type as 'text' | 'number');
      if (q && !seen.has(q.id)) { qs.push(q); seen.add(q.id); }
    }

    for (const el of await this.page.locator('select').all()) {
      if (!await el.isVisible().catch(() => false)) continue;
      const opts = await el.locator('option').allInnerTexts();
      const q = await this.buildQ(el, 'select', opts.filter(Boolean));
      if (q && !seen.has(q.id)) { qs.push(q); seen.add(q.id); }
    }

    return qs;
  }

  private async navigate(url: string): Promise<void> {
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch {
      await this.page.goto(url, { waitUntil: 'commit', timeout: 10000 }).catch(() => {});
    }
    await delay(1500, 2500);
  }

  private async dismissModals(): Promise<void> {
    await this.tryDismiss(
      'div[role="dialog"]:has-text("desatualizado"), div[role="dialog"]:has-text("Atualizar currículo")',
      'button:has-text("Continuar"), button:has-text("Candidatar mesmo assim"), button:has-text("Pular"), button:has-text("Ignorar")',
      'currículo desatualizado'
    );
    await this.tryDismiss(
      'div[role="dialog"]:has-text("Complete seu perfil"), div[role="dialog"]:has-text("perfil incompleto")',
      'button:has-text("Pular"), button:has-text("Continuar"), button:has-text("Fechar"), button[aria-label="Fechar"]',
      '"Complete seu perfil"'
    );
    await this.tryDismiss(
      'div[role="dialog"]:has-text("Salvar")',
      'button:has-text("Salvar")',
      '"Salvar candidatura"'
    );
  }

  private async tryDismiss(modalSel: string, btnSel: string, label: string): Promise<void> {
    try {
      if (await this.page.locator(modalSel).count() === 0) return;
      const btn = this.page.locator(modalSel).locator(btnSel).first();
      if (await btn.count() > 0) {
        await btn.click();
        await delay(600, 1000);
        console.log(`[Catho/Apply] Modal ${label} dispensado.`);
      }
    } catch { /* non-fatal */ }
  }

  private async handleFileUpload(resumePath: string): Promise<void> {
    const input = this.page.locator('input[type="file"]').first();
    if (await input.count() === 0) return;
    try {
      await input.setInputFiles(resumePath);
      await delay(800, 1500);
      console.log('[Catho/Apply] Currículo enviado.');
    } catch { /* already uploaded */ }
  }

  private async answerQuestions(onQuestion: CathoApplyOptions['onQuestion']): Promise<void> {
    for (const q of await this.collectQuestions()) {
      try {
        const answer = await onQuestion(q);
        if (!answer) continue;
        if (q.type === 'select') {
          await this.page.selectOption(`#${q.id}`, { label: answer }, { timeout: 3000 }).catch(() => {});
        } else {
          await this.page.fill(`#${q.id}`, answer, { timeout: 3000 }).catch(() => {});
        }
        await delay(200, 400);
      } catch { /* non-fatal */ }
    }
  }

  private async buildQ(
    el: Locator,
    type: QuestionnaireQuestion['type'],
    options?: string[]
  ): Promise<QuestionnaireQuestion | null> {
    try {
      const id    = (await el.getAttribute('id')) ?? `catho_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const label = await this.getLabel(el);
      if (!label) return null;
      const required =
        (await el.getAttribute('required')) !== null ||
        (await el.getAttribute('aria-required')) === 'true';
      return { id, text: label, type, options, required };
    } catch { return null; }
  }

  private async getLabel(el: Locator): Promise<string | null> {
    const id = await el.getAttribute('id').catch(() => null);
    if (id) {
      const lbl = this.page.locator(`label[for="${id}"]`);
      if (await lbl.count() > 0) {
        const txt = (await lbl.first().innerText()).trim();
        if (txt) return txt;
      }
    }
    const aria = await el.getAttribute('aria-label').catch(() => null);
    if (aria?.trim()) return aria.trim();
    const ph = await el.getAttribute('placeholder').catch(() => null);
    if (ph?.trim()) return ph.trim();
    return null;
  }

  private async detectAction(): Promise<'submit' | 'next' | 'unknown'> {
    const submitSel = [
      'button[data-testid="submit-button"]',
      'button:has-text("Enviar candidatura")',
      'button:has-text("Finalizar candidatura")',
      'button:has-text("Concluir")',
      'button:has-text("Enviar currículo")',
      'button[type="submit"]:has-text("Enviar")',
    ].join(', ');
    const sub = this.page.locator(submitSel);
    if (await sub.count() > 0 && await sub.first().isEnabled().catch(() => false)) return 'submit';

    const nextSel = [
      'button[data-testid="next-button"]',
      'button:has-text("Próximo")',
      'button:has-text("Continuar")',
      'button:has-text("Avançar")',
    ].join(', ');
    if (await this.page.locator(nextSel).count() > 0) return 'next';

    return 'unknown';
  }

  private async submitForm(): Promise<void> {
    await this.clickFirst([
      'button[data-testid="submit-button"]',
      'button:has-text("Enviar candidatura")',
      'button:has-text("Finalizar candidatura")',
      'button:has-text("Concluir")',
    ]);
    await delay(2000, 3500);
    console.log('[Catho/Apply] ✅ Candidatura submetida.');
  }

  private async clickFirst(selectors: string[]): Promise<void> {
    const btn = this.page.locator(selectors.join(', ')).first();
    await btn.click().catch(async () => { await btn.dispatchEvent('click'); });
  }

  private async detectCaptcha(): Promise<boolean> {
    const sels = ['iframe[src*="recaptcha"]', 'iframe[src*="captcha"]', '.g-recaptcha', '[data-sitekey]'];
    for (const s of sels) {
      if (await this.page.locator(s).count() > 0) return true;
    }
    const body = await this.page.locator('body').innerText().catch(() => '');
    return /captcha|verificação de segurança|robô/i.test(body);
  }
}
