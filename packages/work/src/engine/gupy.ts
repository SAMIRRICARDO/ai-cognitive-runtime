// packages/work/src/engine/gupy.ts
// Gupy é a plataforma de RH dominante no Brasil — usada por >3000 empresas
// Busca via API HTTP (job-search.gupy.io) — evita Cloudflare/bot-detection
// Playwright só para o fluxo de apply

import { Page } from 'playwright';
import { Job, QuestionnaireQuestion } from '../types/index.js';

const delay = (min: number, max: number) =>
  new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));

// Headers comuns para as chamadas à API Gupy
const GUPY_API_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Referer': 'https://portal.gupy.io/',
  'Origin': 'https://portal.gupy.io',
};

// Empresas alvo com seus slugs Gupy (expandir conforme watchlist)
const GUPY_COMPANY_SLUGS: Record<string, string> = {
  'nubank': 'nubank',
  'itaú': 'itau-unibanco',
  'stone': 'stone-pagamentos',
  'totvs': 'totvs',
  'vtex': 'vtex',
  'ifood': 'ifood',
  'rappi': 'rappi',
  'mercado livre': 'mercadolivre',
  'xp inc': 'xp-investimentos',
  'ambev tech': 'ambevtech',
  'globo': 'globo',
  'senior sistemas': 'senior-sistemas',
  'creditas': 'creditas',
  'loft': 'loft',
  'dock': 'dock',
};

export interface GupySearchConfig {
  keywords: string[];
  companyWatchlist?: string[];   // slugs Gupy ou nomes do mapa acima
  useGupyBoard?: boolean;        // busca no board central gupy.io/vagas
  locations?: string[];
}

export interface GupyJob extends Job {
  gupyJobId: string;
  companySlug: string;
  applicationUrl: string;
}

// Slug válido: minúsculas/dígitos/hífens, sem hífen nas bordas, 3–62 chars
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/.test(slug);
}

// Seletores de card Gupy 2025/2026
const GUPY_CARD_SEL = '[data-testid="job-card"], [class*="JobCard"], article';

export class GupySearchEngine {
  constructor(private page: Page) {}

  // ─── Busca via API HTTP (método principal — sem browser, evita Cloudflare) ─
  async searchViaAPI(config: GupySearchConfig): Promise<GupyJob[]> {
    const jobs: GupyJob[] = [];
    const seen = new Set<string>();

    for (const keyword of config.keywords) {
      // API pública do Gupy: job-search.gupy.io
      const params = new URLSearchParams({ name: keyword, limit: '20', offset: '0' });
      if (config.locations?.[0]) params.set('state', 'SP');
      const url = `https://job-search.gupy.io/jobs?${params.toString()}`;
      console.log(`[Gupy API] GET ${url}`);

      try {
        const resp = await fetch(url, { headers: GUPY_API_HEADERS });
        if (!resp.ok) {
          console.warn(`[Gupy API] HTTP ${resp.status} para "${keyword}" — pulando.`);
          await delay(500, 1000);
          continue;
        }

        const data = await resp.json() as any;
        // A API pode retornar { data: [...] } ou { jobs: [...] } ou array direto
        const items: any[] = Array.isArray(data)
          ? data
          : (data.data ?? data.jobs ?? data.results ?? []);

        console.log(`[Gupy API] ${items.length} vagas para "${keyword}"`);

        for (const item of items) {
          const id = String(item.id ?? item.jobId ?? '');
          if (!id || seen.has(id)) continue;
          seen.add(id);

          const slug = item.company?.urlName ?? item.companySlug ?? item.company?.name ?? '';
          const appUrl: string =
            item.applicationUrl ??
            (slug ? `https://${slug}.gupy.io/jobs/${id}` : `https://portal.gupy.io/job/${id}`);

          const titleText = (item.name ?? item.title ?? '').toLowerCase();
          const hasMatch = config.keywords.some(k => titleText.includes(k.toLowerCase()));
          if (!hasMatch) continue;

          jobs.push({
            id: `gupy_${id}`,
            gupyJobId: id,
            companySlug: slug,
            title: item.name ?? item.title ?? keyword,
            company: item.company?.name ?? slug,
            location: [item.city, item.state].filter(Boolean).join(', '),
            linkedinUrl: appUrl,
            applicationUrl: appUrl,
            description: item.description ?? '',
            isEasyApply: true,
            scannedAt: new Date().toISOString(),
            platform: 'gupy',
          });
        }
      } catch (err) {
        console.warn(`[Gupy API] Erro para "${keyword}":`, String(err).slice(0, 120));
      }

      await delay(400, 900);
    }

    // Busca também por empresa via API
    if (config.companyWatchlist?.length) {
      const companyJobs = await this.searchCompaniesByAPI(config);
      for (const j of companyJobs) {
        if (!seen.has(j.id)) { seen.add(j.id); jobs.push(j); }
      }
    }

    return this.dedup(jobs);
  }

  // ─── Busca empresas específicas via API ───────────────────────────────────
  private async searchCompaniesByAPI(config: GupySearchConfig): Promise<GupyJob[]> {
    const jobs: GupyJob[] = [];
    const slugs = this.resolveCompanySlugs(config.companyWatchlist ?? []);

    for (const slug of slugs) {
      // Tenta descobrir companyId via slug usando a API de companies
      const params = new URLSearchParams({ name: config.keywords[0] ?? 'desenvolvedor', limit: '20', offset: '0', companyName: slug });
      const url = `https://job-search.gupy.io/jobs?${params.toString()}`;
      console.log(`[Gupy API] Company "${slug}": ${url}`);

      try {
        const resp = await fetch(url, { headers: GUPY_API_HEADERS });
        if (!resp.ok) { await delay(300, 700); continue; }
        const data = await resp.json() as any;
        const items: any[] = Array.isArray(data) ? data : (data.data ?? data.jobs ?? []);
        console.log(`[Gupy API] ${items.length} vagas em ${slug}`);

        for (const item of items) {
          const id = String(item.id ?? '');
          if (!id) continue;
          const appUrl: string = item.applicationUrl ?? `https://portal.gupy.io/job/${id}`;
          jobs.push({
            id: `gupy_${id}`,
            gupyJobId: id,
            companySlug: slug,
            title: item.name ?? item.title ?? 'Vaga',
            company: item.company?.name ?? slug,
            location: [item.city, item.state].filter(Boolean).join(', '),
            linkedinUrl: appUrl,
            applicationUrl: appUrl,
            description: item.description ?? '',
            isEasyApply: true,
            scannedAt: new Date().toISOString(),
            platform: 'gupy',
          });
        }
      } catch { /* ignora erros por empresa */ }

      await delay(300, 700);
    }

    return jobs;
  }

  // ─── Busca no board central do Gupy (fallback browser) ───────────────────
  async searchBoard(config: GupySearchConfig): Promise<GupyJob[]> {
    const jobs: GupyJob[] = [];

    for (const keyword of config.keywords) {
      const url = this.buildBoardUrl(keyword, config.locations?.[0]);
      console.log(`[Gupy] Board search: ${url}`);

      try {
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch {
        console.warn(`[Gupy] Timeout ao carregar board para "${keyword}" — pulando.`);
        continue;
      }
      await delay(2000, 3500);

      await this.scrollToLoadAll();

      const cards = await this.page.$$(GUPY_CARD_SEL);
      console.log(`[Gupy] ${cards.length} vagas encontradas para "${keyword}"`);

      for (const card of cards) {
        try {
          const job = await this.extractFromBoardCard(card, keyword);
          if (job) jobs.push(job);
        } catch {
          // card malformado
        }
      }

      await delay(2000, 4000);
    }

    return this.dedup(jobs);
  }

  // ─── Busca direta nas empresas da watchlist ──────────────────────────────
  async searchCompanyBoards(config: GupySearchConfig): Promise<GupyJob[]> {
    const jobs: GupyJob[] = [];
    const slugs = this.resolveCompanySlugs(config.companyWatchlist ?? []);

    for (const slug of slugs) {
      if (!isValidSlug(slug)) {
        console.warn(`[Gupy] Slug inválido na watchlist: "${slug}" — pulando.`);
        continue;
      }

      const loadedUrl = await this.openCompanyBoard(slug);
      if (!loadedUrl) {
        console.warn(`[Gupy] Nenhuma URL de board respondeu 200 para "${slug}" — pulando.`);
        continue;
      }

      try {
        await delay(1500, 3000);

        // Verifica se a página carregou corretamente
        const title = await this.page.title();
        if (title.toLowerCase().includes('404') || title.toLowerCase().includes('not found')) {
          console.warn(`[Gupy] Board não encontrado para slug: ${slug}`);
          continue;
        }

        await this.scrollToLoadAll();

        const cards = await this.page.$$(GUPY_CARD_SEL);
        console.log(`[Gupy] ${cards.length} vagas em ${slug}`);

        for (const card of cards) {
          try {
            const job = await this.extractFromCompanyCard(card, slug);
            if (job && this.matchesKeywords(job, config.keywords)) {
              jobs.push(job);
            }
          } catch {
            // ignora
          }
        }
      } catch (err) {
        console.warn(`[Gupy] Erro ao processar board de ${slug}:`, err);
      }

      await delay(2000, 4000);
    }

    return this.dedup(jobs);
  }

  // Tenta as duas variantes de URL de board de empresa; retorna a que respondeu 200
  private async openCompanyBoard(slug: string): Promise<string | null> {
    const candidates = [
      `https://${slug}.gupy.io/jobs`,
      `https://portal.gupy.io/companies/${slug}/jobs`,
    ];

    for (const url of candidates) {
      console.log(`[Gupy] Company board: ${url}`);
      try {
        const response = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        if (response && response.status() === 200) return url;
        console.warn(`[Gupy] ${url} respondeu ${response?.status() ?? 'sem resposta'} — tentando próxima.`);
      } catch (err) {
        console.warn(`[Gupy] Falha ao acessar ${url}: ${String(err).slice(0, 80)}`);
      }
    }
    return null;
  }

  // ─── Scrape descrição completa ────────────────────────────────────────────
  async scrapeJobDescription(job: GupyJob): Promise<string> {
    await this.page.goto(job.applicationUrl, { waitUntil: 'domcontentloaded' });
    await delay(1500, 3000);

    const selectors = [
      '[data-testid="job-description"]',
      '.sc-dkrFOg',
      '.job-description',
      'section[class*="description"]',
    ];

    for (const sel of selectors) {
      const el = this.page.locator(sel);
      if (await el.count() > 0) {
        return (await el.first().innerText()).trim();
      }
    }

    return '';
  }

  private buildBoardUrl(keyword: string, location?: string): string {
    // Board central Gupy 2025/2026: portal.gupy.io/vagas?jobName=...
    const params = new URLSearchParams();
    params.set('jobName', keyword);
    if (location) params.set('city', location);
    return `https://portal.gupy.io/vagas?${params.toString()}`;
  }

  private async scrollToLoadAll(): Promise<void> {
    let lastHeight = 0;
    for (let i = 0; i < 8; i++) {
      const newHeight: number = await this.page.evaluate(() => document.body.scrollHeight);
      if (newHeight === lastHeight) break;
      lastHeight = newHeight;
      await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await delay(1000, 2000);
    }
  }

  private async extractFromBoardCard(card: any, keyword: string): Promise<GupyJob | null> {
    const linkEl = await card.$('a[href*="gupy.io"]');
    if (!linkEl) return null;

    const href = await linkEl.getAttribute('href') ?? '';
    const idMatch = href.match(/\/(\d+)(?:\?|$)/);
    const slugMatch = href.match(/https?:\/\/([^.]+)\.gupy\.io/);

    if (!idMatch || !slugMatch) return null;

    const slug = slugMatch[1] ?? '';
    if (!slug || !isValidSlug(slug)) {
      console.warn(`[Gupy] jobToken/slug inválido extraído de "${href.slice(0, 80)}" — pulando card.`);
      return null;
    }

    const titleEl = await card.$('[data-testid="job-name"], h2, h3, .job-title');
    const companyEl = await card.$('[data-testid="company-name"], .company-name');
    const locationEl = await card.$('[data-testid="job-location"], .location');

    return {
      id: `gupy_${idMatch[1]}`,
      gupyJobId: idMatch[1],
      companySlug: slug,
      title: titleEl ? (await titleEl.innerText()).trim() : keyword,
      company: companyEl ? (await companyEl.innerText()).trim() : slug,
      location: locationEl ? (await locationEl.innerText()).trim() : '',
      linkedinUrl: href,
      applicationUrl: href,
      description: '',
      isEasyApply: true, // Gupy sempre tem fluxo próprio
      scannedAt: new Date().toISOString(),
      platform: 'gupy',
    };
  }

  private async extractFromCompanyCard(card: any, slug: string): Promise<GupyJob | null> {
    const linkEl = await card.$('a');
    if (!linkEl) return null;

    const href = await linkEl.getAttribute('href') ?? '';
    const fullUrl = href.startsWith('http')
      ? href
      : `https://${slug}.gupy.io${href}`;

    const idMatch = fullUrl.match(/\/(\d+)(?:\?|$)/);
    if (!idMatch) return null;

    const titleEl = await card.$('h2, h3, [class*="title"]');
    const locationEl = await card.$('[class*="location"], [class*="city"]');

    return {
      id: `gupy_${idMatch[1]}`,
      gupyJobId: idMatch[1],
      companySlug: slug,
      title: titleEl ? (await titleEl.innerText()).trim() : 'Vaga',
      company: slug,
      location: locationEl ? (await locationEl.innerText()).trim() : '',
      linkedinUrl: fullUrl,
      applicationUrl: fullUrl,
      description: '',
      isEasyApply: true,
      scannedAt: new Date().toISOString(),
      platform: 'gupy',
    };
  }

  private resolveCompanySlugs(watchlist: string[]): string[] {
    return watchlist.map(name => {
      const lower = name.toLowerCase();
      return GUPY_COMPANY_SLUGS[lower] ?? lower.replace(/\s+/g, '-');
    });
  }

  private matchesKeywords(job: GupyJob, keywords: string[]): boolean {
    const text = `${job.title} ${job.description}`.toLowerCase();
    return keywords.some(k => text.includes(k.toLowerCase()));
  }

  private dedup(jobs: GupyJob[]): GupyJob[] {
    const seen = new Set<string>();
    return jobs.filter(j => {
      if (seen.has(j.id)) return false;
      seen.add(j.id);
      return true;
    });
  }
}

// ─── Apply Engine Gupy ───────────────────────────────────────────────────────

export interface GupyApplyOptions {
  resumePath: string;
  onQuestion: (q: QuestionnaireQuestion) => Promise<string>;
  dryRun?: boolean;
  personalData: GupyPersonalData;
}

export interface GupyPersonalData {
  name: string;
  email: string;
  phone: string;
  linkedin?: string;
  portfolio?: string;
}

export class GupyApplyEngine {
  constructor(private page: Page) {}

  async apply(job: GupyJob, options: GupyApplyOptions): Promise<boolean> {
    try {
      await this.page.goto(job.applicationUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch {
      console.warn(`[Gupy] Timeout ao abrir vaga: ${job.applicationUrl.slice(0, 80)}`);
      return false;
    }
    await delay(1500, 3000);

    // Botão de candidatura — seletores 2025
    const applyBtn = this.page.locator(
      'button[data-testid*="apply"], ' +
      'a[data-testid*="apply"], ' +
      'button:has-text("Candidatar"), ' +
      'button:has-text("Me candidatar"), ' +
      'button:has-text("Aplicar"), ' +
      'a:has-text("Candidatar")'
    );

    if (await applyBtn.count() === 0) {
      console.warn(`[Gupy] Botão de candidatura não encontrado: ${job.applicationUrl}`);
      return false;
    }

    await applyBtn.first().click();
    await delay(1000, 2000);

    // Gupy pode redirecionar para login — verifica
    if (this.page.url().includes('/auth') || this.page.url().includes('/login')) {
      console.warn('[Gupy] Requer login. Configure GUPY_EMAIL/GUPY_PASSWORD.');
      const logged = await this.loginGupy(
        process.env.GUPY_EMAIL ?? '',
        process.env.GUPY_PASSWORD ?? ''
      );
      if (!logged) return false;

      // Volta para a vaga após login
      await this.page.goto(job.applicationUrl, { waitUntil: 'domcontentloaded' });
      await delay(1500, 2500);
      await applyBtn.first().click();
      await delay(1000, 2000);
    }

    // Navega steps do formulário
    let step = 0;
    const maxSteps = 8;

    while (step < maxSteps) {
      step++;
      console.log(`[Gupy] Step ${step}`);

      // Preenche dados pessoais se presentes
      await this.fillPersonalData(options.personalData);

      // Upload de currículo
      await this.handleFileUpload(options.resumePath);

      // Responde perguntas customizadas
      await this.handleCustomQuestions(options.onQuestion);

      if (options.dryRun) {
        console.log('[Gupy] DRY RUN — não submetendo.');
        return true;
      }

      const action = await this.detectAction();

      if (action === 'submit') {
        return await this.submitForm();
      }

      if (action === 'next') {
        await this.clickNext();
        await delay(800, 1500);
        continue;
      }

      // Chegou ao fim sem botão de submit
      break;
    }

    return false;
  }

  private async loginGupy(email: string, password: string): Promise<boolean> {
    if (!email || !password) return false;

    await this.page.fill('input[type="email"], input[name="email"]', email);
    await delay(300, 600);
    await this.page.fill('input[type="password"]', password);
    await delay(300, 600);

    const loginBtn = this.page.locator('button[type="submit"]');
    await loginBtn.first().click();
    await delay(2000, 3500);

    return !this.page.url().includes('/login') && !this.page.url().includes('/auth');
  }

  private async fillPersonalData(data: GupyPersonalData): Promise<void> {
    const fields: Array<[string, string]> = [
      ['input[name="name"], input[placeholder*="nome"], input[placeholder*="Nome"]', data.name],
      ['input[type="email"]', data.email],
      ['input[name="phone"], input[placeholder*="telefone"], input[placeholder*="celular"]', data.phone],
    ];

    if (data.linkedin) {
      fields.push(['input[placeholder*="LinkedIn"], input[name*="linkedin"]', data.linkedin]);
    }
    if (data.portfolio) {
      fields.push(['input[placeholder*="portfólio"], input[name*="portfolio"]', data.portfolio]);
    }

    for (const [selector, value] of fields) {
      const el = this.page.locator(selector).first();
      if (await el.count() > 0) {
        const current = await el.inputValue().catch(() => '');
        if (!current) {
          await el.fill(value);
          await delay(200, 400);
        }
      }
    }
  }

  private async handleFileUpload(resumePath: string): Promise<void> {
    const fileInput = this.page.locator('input[type="file"]').first();
    if (await fileInput.count() > 0) {
      await fileInput.setInputFiles(resumePath);
      await delay(800, 1500);
      console.log('[Gupy] Currículo enviado.');
    }
  }

  async collectCustomQuestions(): Promise<QuestionnaireQuestion[]> {
    const questions: QuestionnaireQuestion[] = [];

    // Perguntas dissertativas (textarea)
    const textareas = await this.page.$$('textarea');
    for (const ta of textareas) {
      const label = await this.getLabelFor(ta);
      if (!label) continue;
      questions.push({
        id: (await ta.getAttribute('id')) ?? `gupy_q_${Date.now()}_${Math.random()}`,
        text: label,
        type: 'textarea',
        required: (await ta.getAttribute('required')) !== null,
      });
    }

    // Text inputs não preenchidos (exclui dados pessoais já tratados)
    // Inclui campos 2025 com data-testid (podem não ser type="text")
    const inputs = await this.page.$$(
      'input[type="text"]:not([name="name"]):not([name="phone"]), ' +
      'input[data-testid]:not([type="file"]):not([type="radio"]):not([type="checkbox"]):not([type="hidden"]):not([name="name"]):not([name="phone"])'
    );
    for (const inp of inputs) {
      const label = await this.getLabelFor(inp);
      if (!label) continue;
      const val = await inp.evaluate((el: HTMLInputElement) => el.value);
      if (val) continue; // já preenchido
      questions.push({
        id: (await inp.getAttribute('id')) ?? `gupy_q_${Date.now()}_${Math.random()}`,
        text: label,
        type: 'text',
        required: (await inp.getAttribute('required')) !== null,
      });
    }

    // Selects
    const selects = await this.page.$$('select');
    for (const sel of selects) {
      const label = await this.getLabelFor(sel);
      if (!label) continue;
      const opts = await sel.$$eval('option', (els: HTMLOptionElement[]) =>
        els.map(e => e.text).filter(Boolean)
      );
      questions.push({
        id: (await sel.getAttribute('id')) ?? `gupy_q_${Date.now()}_${Math.random()}`,
        text: label,
        type: 'select',
        options: opts,
        required: (await sel.getAttribute('required')) !== null,
      });
    }

    return questions;
  }

  private async handleCustomQuestions(
    onQuestion: (q: QuestionnaireQuestion) => Promise<string>
  ): Promise<void> {
    const questions = await this.collectCustomQuestions();
    for (const q of questions) {
      const answer = await onQuestion(q);
      if (!answer) continue;
      try {
        await this.fillQuestion(q, answer);
        await delay(200, 400);
      } catch (err) {
        console.warn(`[Gupy] Erro ao preencher "${q.text.slice(0, 50)}":`, err);
      }
    }
  }

  private async fillQuestion(q: QuestionnaireQuestion, value: string): Promise<void> {
    if (q.type === 'textarea') {
      await this.page.fill(`textarea#${q.id}, textarea[id="${q.id}"]`, value);
    } else if (q.type === 'text') {
      await this.page.fill(`input#${q.id}, input[id="${q.id}"]`, value);
    } else if (q.type === 'select') {
      await this.page.selectOption(`select#${q.id}`, { label: value });
    }
  }

  private async getLabelFor(field: any): Promise<string | null> {
    try {
      const id = await field.getAttribute('id');
      if (id) {
        const label = this.page.locator(`label[for="${id}"]`);
        if (await label.count() > 0) return (await label.first().innerText()).trim();
      }
      const ariaLabel = await field.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel.trim();

      // Tenta label pai
      const parentLabel = await field.evaluate((el: Element) => {
        const parent = el.closest('label');
        return parent?.textContent?.trim() ?? null;
      });
      return parentLabel;
    } catch {
      return null;
    }
  }

  private async detectAction(): Promise<'next' | 'submit' | 'unknown'> {
    const submitSelectors = [
      'button[type="submit"]:has-text("Enviar")',
      'button:has-text("Finalizar candidatura")',
      'button:has-text("Concluir")',
      'button[data-testid="submit-button"]',
    ];
    for (const sel of submitSelectors) {
      const btn = this.page.locator(sel);
      if (await btn.count() > 0 && await btn.first().isEnabled()) return 'submit';
    }

    const nextSelectors = [
      'button:has-text("Próximo")',
      'button:has-text("Continuar")',
      'button:has-text("Avançar")',
      'button[data-testid="next-button"]',
    ];
    for (const sel of nextSelectors) {
      if (await this.page.locator(sel).count() > 0) return 'next';
    }

    return 'unknown';
  }

  private async clickNext(): Promise<void> {
    const btn = this.page.locator(
      'button:has-text("Próximo"), button:has-text("Continuar"), button:has-text("Avançar")'
    ).first();
    await btn.click();
  }

  private async submitForm(): Promise<boolean> {
    const btn = this.page.locator(
      'button[type="submit"], button:has-text("Finalizar"), button:has-text("Enviar candidatura")'
    ).first();
    if (await btn.count() === 0) {
      console.warn('[Gupy] Botão de submit não encontrado — abortando graciosamente.');
      return false;
    }
    await btn.click().catch(() => {});
    await delay(2000, 3500);

    // Modal/indicador de sucesso 2025
    const successSel =
      '[data-testid="success-modal"], ' +
      'div:has-text("candidatura enviada"), ' +
      'div:has-text("Candidatura enviada")';
    if ((await this.page.locator(successSel).count().catch(() => 0)) > 0) {
      console.log('[Gupy] ✅ Candidatura submetida — modal de sucesso detectado.');
      return true;
    }

    const body = await this.page.locator('body').innerText().catch(() => '');
    if (/candidatura enviada|candidatura realizada|obrigado/i.test(body)) {
      console.log('[Gupy] ✅ Candidatura submetida — confirmação via texto.');
      return true;
    }

    console.log('[Gupy] ✅ Candidatura submetida (sem confirmação explícita).');
    return true;
  }
}
