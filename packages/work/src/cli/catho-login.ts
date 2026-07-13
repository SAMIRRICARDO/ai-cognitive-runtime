// Login manual no Catho com browser headed — salva cookies para uso futuro
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), override: false });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false });

import { chromium } from 'playwright';
import fs from 'fs';

const SESSION_DIR  = path.resolve(process.cwd(), '.vraxia-work', 'catho-session');
const COOKIES_PATH = path.join(SESSION_DIR, 'cookies.json');

async function main() {
  console.log('\n🔐 VRAXIA — Login manual no Catho\n');
  console.log('1. O Chrome vai abrir na página de login do Catho.');
  console.log('2. Faça login normalmente (email/senha ou Google).');
  console.log('3. Após entrar, a sessão será salva automaticamente.\n');

  // Usa Chrome do sistema para que Google OAuth não bloqueie (Chromium bundled é detectado)
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.CHROME_PATH ?? '',
  ].filter(Boolean);

  const executablePath = chromePaths.find(p => fs.existsSync(p)) || undefined;
  if (executablePath) console.log(`Usando Chrome: ${executablePath}`);
  else console.log('Chrome não encontrado — usando Chromium bundled.');

  const browser = await chromium.launch({
    headless: false,
    executablePath,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    viewport: null,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  await page.goto('https://www.catho.com.br/signin/', { waitUntil: 'domcontentloaded' });

  console.log('Aguardando login... (feche esta janela após entrar na conta)\n');

  // Aguarda até a URL sair do /signin/
  try {
    await page.waitForFunction(
      () => !window.location.pathname.startsWith('/signin'),
      { timeout: 300000 } // 5 minutos para login manual
    );
  } catch {
    console.log('Timeout atingido sem detectar login completo. Salvando cookies do estado atual...');
  }

  // Verifica se está logado
  const url = page.url();
  const indicators = [
    'a[href*="meu-perfil"]',
    'a[href*="minha-conta"]',
    '[data-testid="user-menu"]',
    '[data-testid="candidate-menu"]',
    '.sc-candidate-name',
  ].join(', ');
  const loggedIn = url.includes('/area-candidato/') || (await page.locator(indicators).count()) > 0;

  if (loggedIn) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    const cookies = await context.cookies();
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
    console.log(`✅ Login confirmado! Cookies salvos em:\n   ${COOKIES_PATH}`);
    console.log('\nPróximas execuções do hunt usarão esses cookies automaticamente.\n');
  } else {
    console.log(`⚠️  Login não detectado. URL atual: ${url}`);
    console.log('Cookies não foram salvos. Tente novamente.\n');
  }

  await browser.close();
}

main().catch(console.error);
