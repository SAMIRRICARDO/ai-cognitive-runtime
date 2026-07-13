// packages/work/src/cli/renew-session.ts
// Renova a sessão do LinkedIn via login manual no browser visível.
// Uso: npx tsx src/cli/renew-session.ts

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), override: false });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false });

import { LinkedInSession } from '../engine/session.js';

const SESSION_DIR  = path.resolve(process.cwd(), '.vraxia-work', 'session');
const COOKIES_PATH = path.join(SESSION_DIR, 'cookies.json');

async function main(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   VRAXIA WORK — Renovação de Sessão      ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // Remove cookies velhos para forçar novo login
  if (fs.existsSync(COOKIES_PATH)) {
    fs.unlinkSync(COOKIES_PATH);
    console.log('[Session] Cookies antigos removidos.');
  }

  const session = new LinkedInSession();
  const page = await session.init({ headless: false, slowMo: 80 });

  console.log('[Session] Browser aberto. Iniciando login...');
  console.log('[Session] Se aparecer CAPTCHA ou verificação, complete manualmente.');
  console.log('[Session] Aguardando até 3 minutos para login...\n');

  const email    = process.env.LINKEDIN_EMAIL    ?? '';
  const password = process.env.LINKEDIN_PASSWORD ?? '';

  if (!email || !password) {
    console.error('[Session] LINKEDIN_EMAIL ou LINKEDIN_PASSWORD não configurados no .env');
    await session.close();
    process.exit(1);
  }

  // Tenta login com credenciais; se der checkpoint abre para intervenção manual
  const loggedIn = await session.login({ email, password });

  if (loggedIn) {
    console.log('\n[Session] ✅ Login bem-sucedido! Cookies salvos em:');
    console.log(`          ${COOKIES_PATH}`);
    console.log('\n[Session] Verificando perfil...');

    // Captura informações da sessão para confirmar
    try {
      await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 15000 });
      const title = await page.title();
      console.log(`[Session] Página: ${title}`);

      // Extrai nome do usuário logado
      const nameEl = await page.$('span.feed-identity-module__actor-meta .t-bold') ??
                     await page.$('[data-control-name="identity_profile_photo"]');
      if (nameEl) {
        const name = await nameEl.textContent();
        console.log(`[Session] Usuário: ${name?.trim()}`);
      }
    } catch {
      // Não crítico
    }

    console.log('\n[Session] Sessão renovada com sucesso. Feche o browser ou aguarde...');
    // Aguarda 5 segundos antes de fechar para o usuário ver
    await new Promise(r => setTimeout(r, 5000));
  } else {
    console.error('\n[Session] ❌ Login falhou. Verifique credenciais ou tente novamente.');
  }

  await session.close();
  process.exit(loggedIn ? 0 : 1);
}

main().catch(err => {
  console.error('[Session] Erro fatal:', err);
  process.exit(1);
});
