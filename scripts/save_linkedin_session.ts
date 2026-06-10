import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT         = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SESSION_DIR  = path.join(ROOT, 'vault', 'imprensa', 'session');
const SESSION_FILE = path.join(SESSION_DIR, 'linkedin_session.json');
// Temp Chrome profile — fresh dir avoids the "non-default data directory" restriction
const PROFILE_DIR  = path.join(ROOT, '.linkedin-profile');

async function main() {
  fs.mkdirSync(SESSION_DIR,  { recursive: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  console.log('\n[LINKEDIN] Abrindo Google Chrome para login...');
  console.log('  → Uma janela do Chrome vai abrir em linkedin.com/login');
  console.log('  → Faça login com seu email e senha normalmente');
  console.log('  → Quando o feed carregar, o script detecta e salva automaticamente');
  console.log('  → NÃO feche a janela do Chrome\n');

  // Uses real Chrome binary with a custom temp profile — LinkedIn doesn't block this
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false,
    viewport: null,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = context.pages()[0] ?? await context.newPage();

  try {
    await page.goto('https://www.linkedin.com/login', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
  } catch {
    // Navigation timeout is ok — page is still open
  }

  console.log('⏳ Aguardando login... (até 5 minutos)\n');

  const deadline = Date.now() + 300_000;
  let loggedIn   = false;

  while (Date.now() < deadline) {
    try {
      await page.waitForTimeout(2_000);
      const url = page.url();
      if (/linkedin\.com\/(feed|mynetwork|jobs|messaging|in\/|company\/)/.test(url)) {
        loggedIn = true;
        break;
      }
    } catch {
      // Page or context was closed by user or LinkedIn — exit loop
      break;
    }
  }

  if (!loggedIn) {
    console.error('\n[ERRO] Login não detectado (timeout ou janela fechada).');
    await context.close().catch(() => {});
    process.exit(1);
  }

  await page.waitForTimeout(3_000);

  const cookies      = await context.cookies();
  const storageState = await context.storageState();

  fs.writeFileSync(SESSION_FILE, JSON.stringify({ cookies, storageState }, null, 2), 'utf-8');

  console.log(`✅ Sessão salva com sucesso`);
  console.log(`📁 Arquivo: ${SESSION_FILE}`);
  console.log(`🍪 Cookies salvos: ${cookies.length}\n`);

  await context.close();
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
