// packages/work/src/engine/search.ts

import { Page } from 'playwright';
import { Job, JobSearchConfig, ApplyType } from '../types/index.js';

const delay = (min: number, max: number) =>
  new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));

// Mapeamento LinkedIn URL params
const EXPERIENCE_MAP: Record<string, string> = {
  INTERNSHIP: '1',
  ENTRY_LEVEL: '2',
  ASSOCIATE: '3',
  MID_SENIOR_LEVEL: '4',
  DIRECTOR: '5',
  EXECUTIVE: '6',
};

const JOB_TYPE_MAP: Record<string, string> = {
  FULL_TIME: 'F',
  PART_TIME: 'P',
  CONTRACT: 'C',
  TEMPORARY: 'T',
  INTERNSHIP: 'I',
  VOLUNTEER: 'V',
  OTHER: 'O',
};

const DATE_MAP: Record<string, string> = {
  any: '',
  month: 'r2592000',
  week: 'r604800',
  '24h': 'r86400',
};

export class JobSearchEngine {
  constructor(private page: Page) {}

  buildSearchUrl(config: JobSearchConfig, locationIndex = 0): string {
    const base = 'https://www.linkedin.com/jobs/search/?';
    const params = new URLSearchParams();

    params.set('keywords', config.keywords.join(' OR '));
    params.set('location', config.locations[locationIndex] ?? 'Brasil');

    if (config.easyApplyOnly) params.set('f_LF', 'f_AL');
    if (config.workType === 'ONSITE') params.set('f_WT', '1');
    else if (config.remoteOnly || config.workType === 'REMOTE') params.set('f_WT', '2');
    else if (config.workType === 'HYBRID') params.set('f_WT', '3');
    else if (config.workType === 'ONSITE_HYBRID') params.set('f_WT', '1,3');

    const expLevels = config.experienceLevels.map(l => EXPERIENCE_MAP[l]).filter(Boolean);
    if (expLevels.length) params.set('f_E', expLevels.join(','));

    const jobTypes = config.jobTypes.map(t => JOB_TYPE_MAP[t]).filter(Boolean);
    if (jobTypes.length) params.set('f_JT', jobTypes.join(','));

    if (config.datePosted !== 'any') params.set('f_TPR', DATE_MAP[config.datePosted]);

    params.set('sortBy', 'DD'); // mais recentes primeiro

    return base + params.toString();
  }

  async scrapeJobList(config: JobSearchConfig): Promise<Job[]> {
    const jobs: Job[] = [];

    for (let locIdx = 0; locIdx < config.locations.length; locIdx++) {
      const url = this.buildSearchUrl(config, locIdx);
      console.log(`[Search] Buscando: ${url}`);

      try {
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      } catch {
        console.warn(`[Search] Timeout para "${config.locations[locIdx]}" — pulando localização.`);
        continue;
      }
      await delay(2000, 4000);

      // Scroll para carregar mais vagas
      await this.scrollJobList();

      const jobCards = await this.page.$$('.job-card-container, .jobs-search-results__list-item');
      console.log(`[Search] ${jobCards.length} cards encontrados para "${config.locations[locIdx]}"`);

      for (const card of jobCards) {
        try {
          const job = await this.extractJobFromCard(card, config.easyApplyOnly);
          if (!job) continue;

          // Filtros rápidos antes de adicionar
          if (this.isBlacklisted(job, config)) {
            console.log(`[Search] Filtrado: ${job.title} @ ${job.company}`);
            continue;
          }

          jobs.push(job);
        } catch (err) {
          // card mal-formado, ignora
        }
      }

      await delay(3000, 6000);
    }

    // Deduplicar por ID
    const seen = new Set<string>();
    return jobs.filter(j => {
      if (seen.has(j.id)) return false;
      seen.add(j.id);
      return true;
    });
  }

  async scrapeJobDescription(linkedinUrl: string): Promise<string> {
    try {
      await this.page.goto(linkedinUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (err) {
      console.warn(`[Search] Falha ao carregar descrição (${linkedinUrl.slice(-20)}): ${String(err).slice(0, 60)}`);
      return '';
    }
    await delay(1500, 3000);

    // Expandir descrição se houver "Ver mais"
    const showMore = this.page.locator('button[aria-label*="Ver mais"], button.show-more-less-html__button');
    if (await showMore.count() > 0) {
      await showMore.first().click();
      await delay(500, 1000);
    }

    const descEl = this.page.locator('.jobs-description__content, .job-view-layout');
    if (await descEl.count() > 0) {
      return (await descEl.first().innerText()).trim();
    }

    return '';
  }

  private async scrollJobList(): Promise<void> {
    const listEl = this.page.locator('.jobs-search-results-list, .scaffold-layout__list');
    if (await listEl.count() === 0) return;

    for (let i = 0; i < 5; i++) {
      await listEl.first().evaluate(el => el.scrollBy(0, 500));
      await delay(800, 1500);
    }
  }

  private async extractJobFromCard(card: any, trustEasyApply = false): Promise<Job | null> {
    // ── Link e ID — múltiplos seletores (LinkedIn muda frequentemente) ────────
    const linkEl = await card.$('a[href*="/jobs/view/"]')
      ?? await card.$('a[href*="currentJobId"]')
      ?? await card.$('a[href*="/jobs/"]');

    if (!linkEl) return null;

    const href     = await linkEl.getAttribute('href') ?? '';
    const idMatch  = href.match(/\/jobs\/view\/(\d+)/)
      ?? href.match(/currentJobId=(\d+)/)
      ?? href.match(/jobs-collections[^/]*\/(\d+)/);
    if (!idMatch) return null;

    // ── Título ────────────────────────────────────────────────────────────────
    const titleEl = await card.$([
      '.job-card-list__title--link',
      '.job-card-list__title',
      '.job-card-container__link',
      'a[data-control-name="job_card_title"]',
      'strong',
    ].join(', '));

    // ── Empresa ───────────────────────────────────────────────────────────────
    const companyEl = await card.$([
      '.job-card-container__primary-description',
      '.artdeco-entity-lockup__subtitle',
      '.job-card-list__company-name',
      '.job-card-container__company-name',
    ].join(', '));

    // ── Localização ───────────────────────────────────────────────────────────
    const locationEl = await card.$([
      '.job-card-container__metadata-item',
      '.artdeco-entity-lockup__caption',
      '.job-search-card__location',
      '.job-card-list__metadata',
    ].join(', '));

    if (!titleEl || !companyEl) return null;

    // ── Easy Apply: seletor HTML ou herança da config (f_LF=f_AL já filtra) ───
    const selectorMatch = !!(await card.$([
      '[aria-label*="Easy Apply"]',
      '[aria-label*="Candidatura simplificada"]',
      '.job-card-container__apply-method',
      'li-icon[type="linkedin-bug"]',
    ].join(', ')));
    const isEasyApply = trustEasyApply || selectorMatch;

    return {
      id: idMatch[1],
      title:      (await titleEl.innerText()).trim(),
      company:    (await companyEl.innerText()).trim(),
      location:   locationEl ? (await locationEl.innerText()).trim() : '',
      linkedinUrl:`https://www.linkedin.com/jobs/view/${idMatch[1]}/`,
      description: '',
      isEasyApply,
      scannedAt:  new Date().toISOString(),
    };
  }

  // ── Detect ATS type from current page (call after scrapeJobDescription) ──────
  async detectApplyType(): Promise<{ type: ApplyType; externalUrl?: string }> {
    // 1. Easy Apply button is the definitive signal
    const easySelectors = [
      'button[aria-label*="Candidatura simplificada"]',
      'button[aria-label*="Easy Apply"]',
      'button.artdeco-button--primary:has-text("Candidatura simplificada")',
      'button.artdeco-button--primary:has-text("Easy Apply")',
    ];
    for (const sel of easySelectors) {
      const btn = this.page.locator(sel).first();
      if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
        console.log(`[Search] applyType: easy_apply (botão detectado)`);
        return { type: 'easy_apply' };
      }
    }

    // 2. Scan all hrefs visible on page for known ATS domains
    const hrefs: string[] = await this.page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map(el => el.getAttribute('href') ?? '')
        .filter(h => h.length > 10)
    ).catch(() => []);

    for (const href of hrefs) {
      if (/greenhouse\.io/i.test(href)) {
        console.log(`[Search] applyType: greenhouse (link encontrado)`);
        return { type: 'greenhouse', externalUrl: href };
      }
      if (/lever\.co/i.test(href)) {
        console.log(`[Search] applyType: lever (link encontrado)`);
        return { type: 'lever', externalUrl: href };
      }
      if (/myworkdayjobs\.com|workday\.com\/[a-z]/i.test(href)) {
        console.log(`[Search] applyType: workday (link encontrado)`);
        return { type: 'workday', externalUrl: href };
      }
    }

    // 3. Scan raw HTML (ATS URL can be in data attrs, script tags, etc.)
    const html: string = await this.page.content().catch(() => '');

    const ghMatch = html.match(/https?:\/\/(?:job-boards|boards)\.greenhouse\.io\/[^\s"'<>]+/i);
    if (ghMatch) {
      console.log(`[Search] applyType: greenhouse (HTML content)`);
      return { type: 'greenhouse', externalUrl: ghMatch[0].split('"')[0] };
    }
    const lvMatch = html.match(/https?:\/\/jobs\.lever\.co\/[^\s"'<>]+/i);
    if (lvMatch) {
      console.log(`[Search] applyType: lever (HTML content)`);
      return { type: 'lever', externalUrl: lvMatch[0].split('"')[0] };
    }
    const wdMatch = html.match(/https?:\/\/[a-z0-9-]+\.myworkdayjobs\.com\/[^\s"'<>]+/i);
    if (wdMatch) {
      console.log(`[Search] applyType: workday (HTML content)`);
      return { type: 'workday', externalUrl: wdMatch[0].split('"')[0] };
    }

    // 4. Try to extract URL from apply button data attributes (no click needed)
    const externalUrl: string | null = await this.page.evaluate(() => {
      const sels = [
        '.jobs-apply-button--top-card a[href]',
        '.job-details-jobs-unified-top-card__cta-container a[href]',
        'a[data-tracking-control-name*="apply"]',
      ];
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const href = el.getAttribute('href') ?? '';
        if (href && !href.includes('linkedin.com')) return href;
      }
      return null;
    }).catch(() => null);

    if (externalUrl) {
      if (/greenhouse\.io/i.test(externalUrl)) return { type: 'greenhouse', externalUrl };
      if (/lever\.co/i.test(externalUrl))       return { type: 'lever', externalUrl };
      if (/myworkdayjobs\.com/i.test(externalUrl)) return { type: 'workday', externalUrl };
      console.log(`[Search] applyType: external (link externo sem ATS reconhecido)`);
      return { type: 'external', externalUrl };
    }

    // 5. Check if there's a non-easy-apply button — click it to follow the redirect
    const applyBtn = this.page.locator([
      '.jobs-apply-button--top-card button:visible',
      '.jobs-s-apply button:visible',
      'button.artdeco-button--primary:visible',
    ].join(', ')).first();

    if (await applyBtn.count() > 0) {
      const txt  = (await applyBtn.innerText().catch(() => '')).trim();
      const aria = (await applyBtn.getAttribute('aria-label').catch(() => '')) ?? '';
      const label = txt || aria;

      if (label && !/candidatura simplificada|easy apply/i.test(label)) {
        console.log(`[Search] Botão externo detectado: "${label.slice(0, 40)}" — clicando para identificar ATS...`);

        try {
          // LinkedIn abre candidatura externa numa nova aba
          const [newPage] = await Promise.all([
            this.page.context().waitForEvent('page', { timeout: 6000 }).catch(() => null),
            applyBtn.click({ timeout: 4000 }).catch(() => {}),
          ]);

          let redirectUrl = '';
          if (newPage) {
            await newPage.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
            redirectUrl = newPage.url();
            await newPage.close().catch(() => {});
          } else {
            await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
            redirectUrl = this.page.url();
            if (redirectUrl.includes('linkedin.com/jobs/view')) {
              // Não navegou — nenhuma nova URL capturada
              redirectUrl = '';
            } else {
              await this.page.goBack({ timeout: 5000 }).catch(() => {});
            }
          }

          console.log(`[Search] Redirect: ${redirectUrl.slice(0, 80)}`);

          if (/greenhouse\.io/i.test(redirectUrl))
            return { type: 'greenhouse', externalUrl: redirectUrl };
          if (/lever\.co/i.test(redirectUrl))
            return { type: 'lever', externalUrl: redirectUrl };
          if (/myworkdayjobs\.com/i.test(redirectUrl))
            return { type: 'workday', externalUrl: redirectUrl };
          if (redirectUrl && !redirectUrl.includes('linkedin.com'))
            return { type: 'external', externalUrl: redirectUrl };
        } catch {
          // Click falhou — classifica como external sem URL
        }

        console.log(`[Search] applyType: external (botão: "${label.slice(0, 40)}")`);
        return { type: 'external' };
      }
    }

    // Default: assume easy_apply (job was listed as easy apply)
    return { type: 'easy_apply' };
  }

  private isBlacklisted(job: Job, config: JobSearchConfig): boolean {
    const titleLower = job.title.toLowerCase();
    const companyLower = job.company.toLowerCase();

    for (const term of config.titleBlacklist) {
      if (titleLower.includes(term.toLowerCase())) return true;
    }
    for (const company of config.companyBlacklist) {
      if (companyLower.includes(company.toLowerCase())) return true;
    }
    return false;
  }
}
