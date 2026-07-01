// login-setup.ts — Configuração de sessão LinkedIn (rodar uma vez)
// Uso: npx tsx login-setup.ts
//
// Abre o Chrome visível, navega ao LinkedIn e aguarda você fazer o login
// manualmente. Após o login, salva os cookies automaticamente para uso
// nas próximas execuções do hunt.

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';

chromium.use(StealthPlugin());

const SESSION_DIR = path.resolve(process.cwd(), '.vraxia-work', 'session');
const COOKIES_PATH = path.join(SESSION_DIR, 'cookies.json');

(async () => {
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  // Limpa sessão anterior se existir
  if (fs.existsSync(COOKIES_PATH)) {
    fs.unlinkSync(COOKIES_PATH);
    console.log('[Setup] Sessão anterior removida.');
  }

  console.log('\n══════════════════════════════════════════════');
  console.log('  VRAXIA WORK — Setup de Sessão LinkedIn');
  console.log('══════════════════════════════════════════════');
  console.log('\n  1. Uma janela do Chrome vai abrir');
  console.log('  2. Faça login no LinkedIn normalmente');
  console.log('  3. Após chegar no feed, os cookies são salvos automaticamente');
  console.log('  4. Não feche esta janela — ela fecha sozinha\n');

  const browser = await (chromium as any).launch({
    headless: false,
    slowMo: 50,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--start-maximized',
    ],
  });

  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: null, // usa tamanho real da janela
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });

  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
  });

  const page = await ctx.newPage();
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

  console.log('Aguardando login... (timeout: 5 minutos)\n');

  try {
    await page.waitForURL(/linkedin\.com\/(feed|mynetwork|jobs)/, { timeout: 300000 });

    const cookies = await ctx.cookies();
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));

    console.log('\n══════════════════════════════════════════════');
    console.log('  ✅ Login bem-sucedido! Cookies salvos em:');
    console.log(`     ${COOKIES_PATH}`);
    console.log('\n  Agora você pode rodar:');
    console.log('  npx tsx src/cli/hunt.ts --dry-run --platform linkedin');
    console.log('══════════════════════════════════════════════\n');

    await new Promise(r => setTimeout(r, 2000));
  } catch {
    console.error('\n❌ Timeout — login não detectado em 5 minutos.');
  }

  await browser.close();
})();
