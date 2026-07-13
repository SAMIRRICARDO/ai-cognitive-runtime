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
      console.log('[Catho] Cookies expirados — fazendo login email/senha...');
    }

    const email    = process.env.CATHO_EMAIL    ?? process.env.LINKEDIN_EMAIL  ?? '';
    const password = process.env.CATHO_PASSWORD ?? process.env.GOOGLE_PASSWORD ?? process.env.LINKEDIN_PASSWORD ?? '';

    // Navega para o signin do Catho
    await this.page.goto('https://www.catho.com.br/signin/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(2000, 3000);

    // Quando temos credenciais, tenta email/senha diretamente (Google OAuth falha em Playwright)
    if (email && password) {
      // Catho pode exibir só o botão Google — procura toggle para "e-mail e senha"
      const emailToggle = this.page.locator(
        'a:has-text("e-mail"), a:has-text("email"), button:has-text("e-mail"), ' +
        'a:has-text("senha"), span:has-text("e-mail e senha"), ' +
        '[data-testid*="email"], a[href*="email"]'
      ).first();

      if (await emailToggle.count() > 0) {
        console.log('[Catho] Clicando em "entrar com e-mail"...');
        await emailToggle.click();
        await delay(1000, 1500);
      }

      // Aguarda campo email aparecer (após toggle ou direto)
      await this.page.waitForSelector(
        'input[type="email"], input[name="email"], input[name="username"]',
        { timeout: 8000 }
      ).catch(() => {});

      const emailInput = this.page.locator('input[type="email"], input[name="email"], input[name="username"]').first();
      const passInput  = this.page.locator('input[type="password"]').first();

      if (await emailInput.count() > 0) {
        console.log('[Catho] Formulário email/senha encontrado — preenchendo...');
        await emailInput.fill(email);
        await delay(500, 800);

        // Se password field já visível, preenche; senão pode precisar de "próximo"
        if (await passInput.count() > 0) {
          await passInput.fill(password);
          await delay(400, 700);
        } else {
          // Tenta clicar "Próximo" para revelar campo senha
          const nextBtn = this.page.locator('button:has-text("Próximo"), button:has-text("Next"), button[type="submit"]').first();
          if (await nextBtn.count() > 0) {
            await nextBtn.click();
            await delay(1500, 2500);
          }
          await this.page.waitForSelector('input[type="password"]', { timeout: 6000 }).catch(() => {});
          if (await passInput.count() > 0) await passInput.fill(password);
        }

        // Submete
        const submitBtn = this.page.locator('button:has-text("Entrar"), button[type="submit"]').first();
        if (await submitBtn.count() > 0) await submitBtn.click();
        await delay(3000, 5000);

        const postUrl = this.page.url();
        console.log(`[Catho] Pós-submit → URL: ${postUrl}`);

        // Extrai mensagem de erro do formulário (ajuda diagnóstico)
        const errMsg = await this.page.locator(
          '[role="alert"], .error, .alert, [class*="error"], [class*="alert"], p[class*="message"], span[class*="error"]'
        ).first().textContent({ timeout: 2000 }).catch(() => null);
        if (errMsg?.trim()) console.log(`[Catho] Mensagem da página: ${errMsg.trim()}`);

        if (await this.isLoggedIn()) {
          await this.saveCookies();
          console.log('[Catho] Login email/senha bem-sucedido. Cookies salvos.');
          return true;
        }

        // Aguarda redirect pós-login (Catho pode demorar para redirecionar)
        console.warn('[Catho] Aguardando redirect pós-login...');
        try {
          await this.page.waitForFunction(
            () =>
              document.location.pathname.includes('/area-candidato') ||
              document.location.pathname.includes('/vagas') ||
              document.location.pathname === '/',
            { timeout: 20000 }
          );
        } catch { /* timeout — verifica mesmo assim */ }
        await delay(1000, 2000);
        if (await this.isLoggedIn()) { await this.saveCookies(); return true; }
      }
    }

    // Checa se já está logado antes do fallback GSI
    if (await this.isLoggedIn()) {
      await this.saveCookies();
      console.log('[Catho] Sessão ativa detectada antes do GSI.');
      return true;
    }

    // Fallback: Google Sign-In (só se não temos credenciais ou email form não encontrado)
    await delay(500, 1000);
    const gsiDiv    = this.page.locator('div.g_id_signin, [data-type="standard"][data-client_id], iframe[title*="Google"]').first();
    const gsiIframe = this.page.frameLocator('iframe[title*="Sign in with Google"], iframe[src*="accounts.google.com/gsi"]').locator('div[role="button"], button').first();

    const hasGsiDiv    = await gsiDiv.count() > 0;
    const hasGsiIframe = await gsiIframe.count() > 0;
    console.log(`[Catho] GSI div: ${hasGsiDiv}, GSI iframe: ${hasGsiIframe}`);

    if (hasGsiIframe) {
      console.log('[Catho] Fallback Google Sign-In via iframe — clicando...');
      return await this.loginGoogleGSI(gsiIframe);
    }
    if (hasGsiDiv) {
      console.log('[Catho] Fallback Google Sign-In via div — clicando...');
      return await this.loginGoogle(gsiDiv);
    }

    if (!email || !password) {
      console.error('[Catho] Credenciais não configuradas — defina CATHO_EMAIL e CATHO_PASSWORD no .env');
      return false;
    }

    console.error('[Catho] Formulário de login não encontrado. URL:', this.page.url());
    return false;
  }

  private async loginGoogleGSI(gsiBtn: import('playwright').Locator): Promise<boolean> {
    let popup: import('playwright').Page | null = null;
    const waitForPopup = this.page.context()
      .waitForEvent('page', { timeout: 20000 })
      .then(p => { popup = p; })
      .catch(() => {});

    await gsiBtn.click().catch(() => {});
    await waitForPopup;
    await delay(2000, 3000);

    // Se já logou (sem popup), retorna sucesso
    if (!popup && await this.isLoggedIn()) {
      await this.saveCookies();
      console.log('[Catho] Login GSI auto-completado (sem popup).');
      return true;
    }

    const oauthPage = popup ?? this.page;
    try {
      if (await oauthPage.locator('input[type="email"]').count() > 0) {
        await oauthPage.fill('input[type="email"]', process.env.CATHO_EMAIL ?? process.env.LINKEDIN_EMAIL ?? '');
        await delay(500, 900);
        await oauthPage.locator('#identifierNext, button:has-text("Next"), button:has-text("Próximo")').first().click({ timeout: 10000 });
        await delay(1500, 2500);
        await oauthPage.waitForSelector('input[type="password"]', { timeout: 10000 }).catch(() => {});
        if (await oauthPage.locator('input[type="password"]').count() > 0) {
          await oauthPage.fill('input[type="password"]', process.env.CATHO_PASSWORD ?? process.env.GOOGLE_PASSWORD ?? '');
          await delay(500, 900);
          await oauthPage.locator('#passwordNext, button:has-text("Next"), button:has-text("Próximo")').first().click({ timeout: 10000 }).catch(() => {});
          await delay(3000, 5000);
        }
      }
    } catch { /* clique timeout — verifica se já logou */ }

    try { await this.page.waitForURL('**catho.com.br**', { timeout: 15000 }); } catch { /* ignore */ }
    await delay(1500, 2500);

    if (await this.isLoggedIn()) {
      await this.saveCookies();
      console.log('[Catho] Login Google GSI bem-sucedido.');
      return true;
    }
    return false;
  }

  private async loginGoogle(googleBtn: import('playwright').Locator): Promise<boolean> {
    let popup: import('playwright').Page | null = null;
    const waitForPopup = this.page.context()
      .waitForEvent('page', { timeout: 15000 })
      .then(p => { popup = p; })
      .catch(() => {});

    await googleBtn.click();
    await waitForPopup;
    await delay(1500, 2500);

    const oauthPage = popup ?? this.page;
    if (await oauthPage.locator('input[type="email"]').count() > 0) {
      await oauthPage.fill('input[type="email"]', process.env.CATHO_EMAIL ?? process.env.LINKEDIN_EMAIL ?? '');
      await delay(500, 900);
      await oauthPage.locator('#identifierNext, button:has-text("Next"), button:has-text("Próximo")').first().click();
      await delay(1500, 2500);
      await oauthPage.waitForSelector('input[type="password"]', { timeout: 10000 }).catch(() => {});
      if (await oauthPage.locator('input[type="password"]').count() > 0) {
        await oauthPage.fill('input[type="password"]', process.env.CATHO_PASSWORD ?? process.env.GOOGLE_PASSWORD ?? '');
        await delay(500, 900);
        await oauthPage.locator('#passwordNext, button:has-text("Next"), button:has-text("Próximo")').first().click();
        await delay(3000, 5000);
      }
    }

    try { await this.page.waitForURL('**catho.com.br**', { timeout: 30000 }); } catch { /* ignore */ }
    await delay(2000, 3000);

    if (await this.isLoggedIn()) {
      await this.saveCookies();
      console.log('[Catho] Login Google bem-sucedido.');
      return true;
    }
    return false;
  }

  async isLoggedIn(): Promise<boolean> {
    // Indicador 1: URL de área logada
    const url = this.page.url();
    if (url.includes('/area-candidato/') && !url.includes('/login/')) return true;

    // Indicador 2: elementos de menu/perfil do candidato
    const indicators = [
      'a[href*="meu-perfil"]',
      'a[href*="minha-conta"]',
      'a[href*="area-candidato"]',
      '[data-testid="user-menu"]',
      '[data-testid="candidate-menu"]',
      '[data-testid="user-avatar"]',
      '.sc-candidate-name',
      'button[aria-label*="Minha conta"]',
      'a:has-text("Sair da conta")',
    ].join(', ');
    if ((await this.page.locator(indicators).count().catch(() => 0)) > 0) return true;

    // Indicador 3: ausência de CTA de login na home (heurística fraca — só se combinada com cookie de sessão)
    const loginCta = await this.page
      .locator('a[href*="/signin"], a:has-text("Entrar"), button:has-text("Entrar")')
      .count()
      .catch(() => 0);
    if (loginCta === 0 && url.includes('catho.com.br') && !url.includes('/signin')) {
      const cookies = await this.page.context().cookies().catch(() => []);
      return cookies.some(c => /session|token|auth/i.test(c.name) && c.domain.includes('catho'));
    }

    return false;
  }

  async saveCookies(): Promise<void> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        fs.mkdirSync(SESSION_DIR, { recursive: true });
        const cookies = await this.page.context().cookies();
        fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
        return;
      } catch (err) {
        console.warn(`[Catho] Falha ao salvar cookies (tentativa ${attempt}/${maxAttempts}):`, err);
        if (attempt === maxAttempts) return; // gracioso — não propaga
        await delay(500 * attempt, 1000 * attempt);
      }
    }
  }
}

// ─── CathoSearchEngine ────────────────────────────────────────────────────────

const CARD_SEL = [
  // Catho atual (2025/2026): article.offer / article.offer.sel / article.offer.highlight
  'article.offer',
  'article[class^="offer"]',
  'article[data-offer-item-subcontainer]',
  // Seletores legados / fallback
  'article[data-testid="job-card"]',
  'div[data-testid="job-card"]',
  'li[class*="JobCard"]',
  'div[class*="JobCard"]',
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

      // Diagnóstico de seletor (só na primeira keyword)
      if (count === 0 && jobs.length === 0 && seen.size === 0) {
        const info = await this.page.evaluate(() => {
          const arts = Array.from(document.querySelectorAll('article')).slice(0, 3);
          return arts.map(a => ({
            tag: a.tagName,
            id: a.id,
            cls: a.className.slice(0, 80),
            dt: JSON.stringify(Object.fromEntries(
              Object.entries(a.dataset).slice(0, 5)
            )),
          }));
        }).catch(() => []);
        if (info.length > 0) {
          console.warn('[Catho] Seletores não batem — artigos encontrados:');
          info.forEach(a => console.warn(`  class="${a.cls}" data=${a.dt}`));
        }
      }

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

    // Vaga já candidatada — badge "Candidatura enviada"
    const appliedBadgeSel = [
      '[data-testid="applied-badge"]',
      '[class*="applied-badge"]',
      '[class*="appliedBadge"]',
      'span:has-text("Candidatura enviada")',
      'div:has-text("Candidatura enviada")',
      'span:has-text("CV enviado")',
    ].join(', ');
    if ((await card.locator(appliedBadgeSel).count().catch(() => 0)) > 0) {
      console.log(`[Catho] Já candidatado (badge): ${title} — pulando.`);
      return null;
    }

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
      return this.abortOnCaptcha('página da vaga');
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

    // Já aplicado? Catho troca o botão por "CV enviado!" após candidatura
    if (await this.page.locator('button:has-text("CV enviado"), :text("CV enviado!")').count() > 0) {
      console.log('[Catho/Apply] ✅ CV já enviado para esta vaga — marcando como aplicado.');
      return true;
    }

    if (await this.page.locator(applyBtnSel).count() === 0) {
      console.warn('[Catho/Apply] Botão de candidatura não encontrado — filtered_out.');
      await this.debugDump('no-apply-btn');
      return false;
    }

    await this.page.locator(applyBtnSel).first().click();
    await delay(2000, 3500);
    await this.dismissModals();

    // Catho frequentemente aplica em 1 clique (perfil + currículo já no cadastro)
    if (await this.detectConfirmation()) {
      console.log('[Catho/Apply] ✅ Candidatura confirmada (one-click).');
      return true;
    }

    // Slug da vaga — guarda contra drift de navegação (ex.: link "Próxima vaga")
    const jobSlug = this.jobSlug(job.applicationUrl);

    for (let step = 0; step < 6; step++) {
      console.log(`[Catho/Apply] Step ${step + 1} — ${this.page.url().slice(0, 70)}`);

      // Se navegou para OUTRA vaga, o clique anterior foi em navegação, não no wizard
      const curSlug = this.jobSlug(this.page.url());
      if (curSlug && jobSlug && curSlug !== jobSlug && !this.inApplyFlow()) {
        console.warn(`[Catho/Apply] Drift de navegação (${curSlug} ≠ ${jobSlug}) — abortando.`);
        return false;
      }

      if (await this.detectCaptcha()) {
        return this.abortOnCaptcha(`step ${step + 1}`);
      }

      await this.dismissModals();
      await this.handleFileUpload(opts.resumePath);
      await this.answerQuestions(opts.onQuestion);
      await this.dismissModals();

      if (await this.detectConfirmation()) {
        console.log('[Catho/Apply] ✅ Candidatura confirmada via texto.');
        return true;
      }

      const action = await this.detectAction();
      console.log(`[Catho/Apply] Ação: ${action}`);

      if (action === 'submit') {
        const confirmed = await this.submitForm();
        if (confirmed) return true;
        // Validação pode ter falhado — tenta próximo step do wizard
        continue;
      }

      if (action === 'next') {
        await this.clickNextInFlow();
        await delay(1500, 2500);
        continue;
      }

      console.warn('[Catho/Apply] Estado desconhecido — encerrando.');
      await this.debugDump(`unknown-step${step + 1}`);
      break;
    }

    return false;
  }

  /** Dump de diagnóstico: URL, dialogs e botões visíveis + screenshot em .vraxia-work/debug/ */
  private async debugDump(tag: string): Promise<void> {
    try {
      const url = this.page.url();
      const dialogs = await this.page.locator('div[role="dialog"]').count();
      const buttons = await this.page.locator('button:visible, a[role="button"]:visible').allInnerTexts()
        .then(ts => ts.map(t => t.trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean).slice(0, 20))
        .catch(() => [] as string[]);
      console.warn(`[Catho/Debug:${tag}] url=${url.slice(0, 90)}`);
      console.warn(`[Catho/Debug:${tag}] dialogs=${dialogs} | botões visíveis: ${JSON.stringify(buttons)}`);

      const dir = path.resolve(process.cwd(), '.vraxia-work', 'debug');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `catho-${tag}-${Date.now()}.png`);
      await this.page.screenshot({ path: file, fullPage: false }).catch(() => {});
      console.warn(`[Catho/Debug:${tag}] screenshot: ${file}`);
    } catch { /* diagnóstico nunca quebra o fluxo */ }
  }

  /** Extrai o slug da vaga de uma URL catho.com.br/vagas/<slug>/... */
  private jobSlug(url: string): string {
    const m = url.match(/\/vagas\/([^/?#]+)/);
    return m?.[1] ?? '';
  }

  /** True quando a URL atual é claramente um fluxo de candidatura (não a página da vaga). */
  private inApplyFlow(): boolean {
    return /candidatura|inscricao|apply/i.test(this.page.url());
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

    // Grupos de radio (sim/não e múltipla escolha) — agrupados por name
    const radioNames = new Set<string>();
    for (const el of await this.page.locator('input[type="radio"]').all()) {
      if (!await el.isVisible().catch(() => false)) continue;
      const name = await el.getAttribute('name').catch(() => null);
      if (!name || radioNames.has(name)) continue;
      radioNames.add(name);

      const group = this.page.locator(`input[type="radio"][name="${name}"]`);
      const options: string[] = [];
      for (const radio of await group.all()) {
        const lbl = await this.getLabel(radio);
        if (lbl) options.push(lbl);
      }
      if (options.length === 0) continue;

      // Texto da pergunta: legend do fieldset mais próximo, senão o name
      const legend = await group.first().evaluate((el: Element) => {
        const fieldset = el.closest('fieldset');
        return fieldset?.querySelector('legend')?.textContent?.trim() ?? null;
      }).catch(() => null);

      const id = `radio_${name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      qs.push({
        id,
        text: legend ?? name,
        type: 'radio',
        options,
        required: (await group.first().getAttribute('required').catch(() => null)) !== null,
      });
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
        if (q.type === 'radio') {
          await this.answerRadio(q, answer);
        } else if (q.type === 'select') {
          await this.page.selectOption(`#${q.id}`, { label: answer }, { timeout: 3000 }).catch(() => {});
        } else {
          await this.page.fill(`#${q.id}`, answer, { timeout: 3000 }).catch(() => {});
        }
        await delay(200, 400);
      } catch { /* non-fatal */ }
    }
  }

  private async answerRadio(q: QuestionnaireQuestion, answer: string): Promise<void> {
    const name = q.id.replace(/^radio_/, '');
    const answerLower = answer.toLowerCase();
    for (const radio of await this.page.locator(`input[type="radio"][name="${name}"]`).all()) {
      const lbl = ((await this.getLabel(radio)) ?? '').toLowerCase();
      if (!lbl) continue;
      if (lbl.includes(answerLower) || answerLower.includes(lbl)) {
        await radio.check({ timeout: 3000 }).catch(async () => {
          await radio.click({ timeout: 2000 }).catch(() => {});
        });
        return;
      }
    }
    console.warn(`[Catho/Apply] Nenhuma opção de radio combinou com "${answer.slice(0, 40)}" (${q.text.slice(0, 40)})`);
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

  /**
   * Escopo do fluxo de candidatura: modal aberto, senão a página inteira APENAS
   * quando a URL é de candidatura. Evita casar "Próximo" da navegação entre vagas.
   */
  private async applyFlowScope(): Promise<Locator | null> {
    const dlg = this.page.locator('div[role="dialog"], [data-testid*="apply-modal"], [class*="ApplyModal"]');
    if (await dlg.count() > 0) return dlg.last();
    if (this.inApplyFlow()) return this.page.locator('body');
    return null;
  }

  private async detectAction(): Promise<'submit' | 'next' | 'unknown'> {
    const scope = await this.applyFlowScope();

    const submitSel = [
      'button[data-testid="submit-button"]',
      'button:has-text("Enviar candidatura")',
      'button:has-text("Finalizar candidatura")',
      'button:has-text("Concluir")',
      'button:has-text("Enviar currículo")',
      'button[type="submit"]:has-text("Enviar")',
    ].join(', ');
    // Submit é específico o suficiente para buscar na página inteira
    const sub = (scope ?? this.page.locator('body')).locator(submitSel);
    if (await sub.count() > 0 && await sub.first().isEnabled().catch(() => false)) return 'submit';

    // "Próximo"/"Continuar" genéricos SÓ dentro do fluxo (modal ou URL de candidatura)
    if (scope) {
      const nextSel = [
        'button[data-testid="next-button"]',
        'button:has-text("Próximo"):not(:has-text("vaga"))',
        'button:has-text("Continuar")',
        'button:has-text("Avançar")',
      ].join(', ');
      if (await scope.locator(nextSel).count() > 0) return 'next';
    }

    return 'unknown';
  }

  /** Clica "next" apenas dentro do escopo do fluxo — nunca na navegação da página. */
  private async clickNextInFlow(): Promise<void> {
    const scope = await this.applyFlowScope();
    if (!scope) return;
    const btn = scope.locator([
      'button[data-testid="next-button"]',
      'button:has-text("Próximo"):not(:has-text("vaga"))',
      'button:has-text("Continuar")',
      'button:has-text("Avançar")',
    ].join(', ')).first();
    await btn.click().catch(async () => { await btn.dispatchEvent('click').catch(() => {}); });
  }

  private async submitForm(): Promise<boolean> {
    await this.clickFirst([
      'button[data-testid="submit-button"]',
      'button:has-text("Enviar candidatura")',
      'button:has-text("Finalizar candidatura")',
      'button:has-text("Concluir")',
    ]);
    await delay(2000, 3500);
    await this.dismissModals();

    if (await this.detectConfirmation()) {
      console.log('[Catho/Apply] ✅ Candidatura submetida e confirmada.');
      return true;
    }

    // Submit ainda presente e habilitado → provável erro de validação no formulário
    if ((await this.detectAction()) === 'submit') {
      console.warn('[Catho/Apply] Submit não avançou — possível erro de validação.');
      return false;
    }

    console.log('[Catho/Apply] ✅ Candidatura submetida (sem confirmação explícita).');
    return true;
  }

  private async detectConfirmation(): Promise<boolean> {
    const successSel = [
      '[data-testid="success-modal"]',
      '[data-testid="application-success"]',
      '[data-testid="applied-confirmation"]',
    ].join(', ');
    if ((await this.page.locator(successSel).count().catch(() => 0)) > 0) return true;

    const body = await this.page.locator('body').innerText().catch(() => '');
    return /candidatura enviada|candidatura realizada|currículo enviado|cv enviado|obrigado por se candidatar|parabéns/i.test(body);
  }

  private abortOnCaptcha(where: string): false {
    console.warn(`[Catho/Apply] CAPTCHA detectado (${where}) — abortando. Sinalizando exit code 2.`);
    process.exitCode = 2;
    return false;
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
