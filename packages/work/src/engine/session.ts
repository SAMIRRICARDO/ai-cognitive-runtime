// packages/work/src/engine/session.ts
// Ported logic from madingess/EasyApplyBot → Playwright TS + stealth

import { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import { LinkedInCredentials } from '../types/index.js';

chromium.use(StealthPlugin());

const SESSION_DIR = path.resolve(process.cwd(), '.vraxia-work', 'session');
const COOKIES_PATH = path.join(SESSION_DIR, 'cookies.json');

// Human-like delays to reduce detection probability
const delay = (min: number, max: number) =>
  new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));

export interface SessionOptions {
  headless?: boolean;
  slowMo?: number;
}

export class LinkedInSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async init(options: SessionOptions = {}): Promise<Page> {
    fs.mkdirSync(SESSION_DIR, { recursive: true });

    // playwright-extra resolve playwright-core do root; cast necessário para alinhar tipos
    this.browser = (await chromium.launch({
      headless: options.headless ?? false,
      slowMo: options.slowMo ?? 50,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
    })) as unknown as Browser;

    this.context = await this.browser!.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      // Remove navigator.webdriver flag
      javaScriptEnabled: true,
    });

    // Locale overrides — webdriver já coberto pelo StealthPlugin
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['pt-BR', 'pt', 'en-US', 'en'],
      });
    });

    // Restore cookies se existirem
    if (fs.existsSync(COOKIES_PATH)) {
      const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
      await this.context.addCookies(cookies);
      console.log('[Session] Cookies restaurados.');
    }

    this.page = await this.context.newPage();
    return this.page;
  }

  async login(credentials: LinkedInCredentials): Promise<boolean> {
    if (!this.page) throw new Error('Session não inicializada. Chame init() primeiro.');

    const page = this.page;

    // Verifica se já está logado via cookie
    try {
      await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch {
      // Timeout na primeira tentativa — tenta com wait mais permissivo
      await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'commit', timeout: 30000 }).catch(() => {});
    }
    await delay(1500, 3000);

    if (page.url().includes('/feed')) {
      console.log('[Session] Já autenticado via cookie.');
      return true;
    }

    console.log('[Session] Iniciando login...');
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await delay(1000, 2000);

    // LinkedIn usa IDs dinâmicos — seletores por autocomplete são estáveis
    const emailField = page.locator('input[autocomplete="username"]').first();

    // Aguarda o SPA montar o formulário (torna-se visível e editável)
    const formReady = await emailField
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    if (!formReady) {
      // Formulário não detectado — aguarda login manual no browser (2 min)
      console.warn('[Session] ⚠️  Formulário de login não detectado. Faça login manualmente no browser aberto.');
      await page.waitForURL(/linkedin\.com\/(feed|mynetwork|jobs)/, { timeout: 120000 });
    } else {
      const passField = page.locator('input[autocomplete="current-password"]').first();

      // Digita caractere a caractere para simular comportamento humano
      await emailField.click();
      for (const char of credentials.email) {
        await page.keyboard.type(char, { delay: Math.random() * 80 + 30 });
      }
      await delay(400, 900);

      await passField.click();
      for (const char of credentials.password) {
        await page.keyboard.type(char, { delay: Math.random() * 80 + 30 });
      }
      await delay(500, 1000);

      // Submit via Enter (LinkedIn SPA sem botão type=submit estável)
      await passField.press('Enter');
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await delay(2000, 4000);
    }

    const url = page.url();
    if (url.includes('/feed') || url.includes('/mynetwork') || url.includes('/jobs')) {
      const cookies = await this.context!.cookies();
      fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
      console.log('[Session] Login bem-sucedido. Cookies salvos.');
      return true;
    }

    // Captcha / checkpoint — aguarda resolução manual (2 min)
    if (url.includes('checkpoint') || url.includes('challenge') || url.includes('authwall')) {
      console.warn('[Session] ⚠️  Verificação manual necessária. Resolva no browser aberto.');
      await page.waitForURL(/linkedin\.com\/(feed|mynetwork|jobs)/, { timeout: 120000 });
      const cookies = await this.context!.cookies();
      fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
      return true;
    }

    console.error('[Session] ❌ Falha no login. URL:', url);
    return false;
  }

  getPage(): Page {
    if (!this.page) throw new Error('Session não inicializada.');
    return this.page;
  }

  async clearSession(): Promise<void> {
    if (fs.existsSync(COOKIES_PATH)) {
      fs.unlinkSync(COOKIES_PATH);
      console.log('[Session] Cookies removidos.');
    }
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.context = null;
    this.page = null;
  }
}
