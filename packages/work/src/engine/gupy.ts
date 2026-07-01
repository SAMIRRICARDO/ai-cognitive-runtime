// packages/work/src/engine/gupy.ts
// Gupy é a plataforma de RH dominante no Brasil — usada por >3000 empresas
// Cada empresa tem subdomínio próprio: empresa.gupy.io/jobs

import { Page } from 'playwright';
import { Job, QuestionnaireQuestion } from '../types/index.js';

const delay = (min: number, max: number) =>
  new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));

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

export class GupySearchEngine {
  constructor(private page: Page) {}

  // ─── Busca no board central do Gupy ─────────────────────────────────────
  async searchBoard(config: GupySearchConfig): Promise<GupyJob[]> {
    const jobs: GupyJob[] = [];

    for (const keyword of config.keywords) {
      const url = this.buildBoardUrl(keyword, config.locations?.[0]);
      console.log(`[Gupy] Board search: ${url}`);

      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
      await delay(2000, 3500);

      await this.scrollToLoadAll();

      const cards = await this.page.$$('[data-testid="job-card"], .sc-bdfxgF, article');
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
      const url = `https://${slug}.gupy.io/jobs`;
      console.log(`[Gupy] Company board: ${url}`);

      try {
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await delay(1500, 3000);

        // Verifica se a página carregou corretamente
        const title = await this.page.title();
        if (title.toLowerCase().includes('404') || title.toLowerCase().includes('not found')) {
          console.warn(`[Gupy] Slug inválido: ${slug}`);
          continue;
        }

        await this.scrollToLoadAll();

        const cards = await this.page.$$('[data-testid="job-card"], article, .job-card');
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
        console.warn(`[Gupy] Erro ao acessar ${slug}.gupy.io:`, err);
      }

      await delay(2000, 4000);
    }

    return this.dedup(jobs);
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
    const params = new URLSearchParams();
    params.set('query', keyword);
    if (location) params.set('city', location);
    return `https://portal.gupy.io/job-search/term?${params.toString()}`;
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

    const titleEl = await card.$('[data-testid="job-name"], h2, h3, .job-title');
    const companyEl = await card.$('[data-testid="company-name"], .company-name');
    const locationEl = await card.$('[data-testid="job-location"], .location');

    return {
      id: `gupy_${idMatch[1]}`,
      gupyJobId: idMatch[1],
      companySlug: slugMatch[1],
      title: titleEl ? (await titleEl.innerText()).trim() : keyword,
      company: companyEl ? (await companyEl.innerText()).trim() : slugMatch[1],
      location: locationEl ? (await locationEl.innerText()).trim() : '',
      linkedinUrl: href,
      applicationUrl: href,
      description: '',
      isEasyApply: true, // Gupy sempre tem fluxo próprio
      scannedAt: new Date().toISOString(),
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
    await this.page.goto(job.applicationUrl, { waitUntil: 'domcontentloaded' });
    await delay(1500, 3000);

    // Tenta clicar no botão de candidatura
    const applyBtn = this.page.locator(
      'button[data-testid="apply-button"], ' +
      'a[data-testid="apply-button"], ' +
      'button:has-text("Candidatar"), ' +
      'button:has-text("Me candidatar"), ' +
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
        await this.submitForm();
        return true;
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
    const inputs = await this.page.$$('input[type="text"]:not([name="name"]):not([name="phone"])');
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

  private async submitForm(): Promise<void> {
    const btn = this.page.locator(
      'button[type="submit"], button:has-text("Finalizar"), button:has-text("Enviar candidatura")'
    ).first();
    await btn.click();
    await delay(2000, 3500);
    console.log('[Gupy] ✅ Candidatura submetida.');
  }
}
