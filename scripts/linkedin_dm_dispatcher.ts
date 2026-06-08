import { chromium, type Page, type BrowserContext } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT          = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PROFILE_DIR   = path.join(ROOT, '.linkedin-profile');
const TEMPLATE_FILE = path.join(ROOT, 'vault', 'imprensa', 'templates', 'template_cto_dm.md');
const LEADS_FILE    = path.join(ROOT, 'leads_validados_2026-06-03.json');
const today         = new Date().toISOString().split('T')[0];
const LOG_FILE      = path.join(ROOT, 'vault', 'imprensa', 'logs', `linkedin_dm_${today}.json`);

const NOTE_CHAR_LIMIT = 300;

const CTO_TARGETS = new Set([
  'Fabio Caversan', 'Fernanda Weiden', 'Thiago Teixeira', 'Felipe Cavalcanti',
  'Rogerio Tessari', 'Daniela Binatti', 'Fabiola Marchiori', 'Gustavo Livrare',
  'Marcus Fontoura', 'Andre Penha',
]);

interface Lead {
  full_name: string; first_name: string; company_name: string;
  linkedin_url: string; [key: string]: unknown;
}
interface DmLog {
  name: string; company: string; linkedin_url: string;
  method: 'message' | 'connect_note' | 'error';
  status: 'sent' | 'error'; error?: string; sent_at: string;
}

function removeFrontmatter(content: string): string {
  if (content.trimStart().startsWith('---')) {
    const start = content.indexOf('---');
    const end   = content.indexOf('---', start + 3);
    if (end !== -1) return content.slice(end + 3).trimStart();
  }
  return content;
}

function buildMessage(template: string, firstName: string, company: string): string {
  return template.replace(/\{\{nome\}\}/g, firstName).replace(/\{\{empresa\}\}/g, company).trim();
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── dry-run ──────────────────────────────────────────────────────────────────

function runDryRun(targets: Lead[], rawTemplate: string): void {
  console.log('\n[DRY-RUN] Nenhuma DM será enviada. Browser não será aberto.\n');
  console.log(`[LINKEDIN DM] ${targets.length} CTOs encontrados\n`);
  for (let i = 0; i < targets.length; i++) {
    const lead    = targets[i];
    const message = buildMessage(rawTemplate, lead.first_name, lead.company_name);
    const fits    = message.length <= NOTE_CHAR_LIMIT;
    console.log(`[${i + 1}/${targets.length}] ${lead.full_name} — ${lead.company_name}`);
    console.log(`  URL    : ${lead.linkedin_url}`);
    console.log(`  CHARS  : ${message.length} / ${NOTE_CHAR_LIMIT} ${fits ? '✓ cabe em nota' : '⚠️  excede'}`);
    console.log(`  DM     :\n${message.split('\n').map(l => `    ${l}`).join('\n')}`);
    console.log('  ' + '─'.repeat(60));
  }
  console.log('\n[RESUMO DRY-RUN]');
  console.log(`  Modo : DRY-RUN (browser não aberto, nenhuma DM enviada)`);
  console.log(`  CTOs : ${targets.length}\n`);
}

// ─── login guard ─────────────────────────────────────────────────────────────

async function ensureLoggedIn(context: BrowserContext): Promise<Page> {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto('https://www.linkedin.com/feed', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await sleep(2_000);

  if (/linkedin\.com\/(login|checkpoint|authwall)/.test(page.url())) {
    console.log('\n⚠️  Faça login na janela do Chrome que abriu.\n');
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      await sleep(2_000);
      if (/linkedin\.com\/(feed|mynetwork|jobs|messaging|in\/|company\/)/.test(page.url())) break;
    }
    if (/linkedin\.com\/(login|checkpoint|authwall)/.test(page.url()))
      throw new Error('Login não concluído em 5 minutos.');
    console.log('✓ Login detectado\n');
  } else {
    console.log('✓ Sessão ativa\n');
  }
  return page;
}

// ─── navigation ───────────────────────────────────────────────────────────────

async function navigateToProfile(page: Page, inputUrl: string): Promise<boolean> {
  await page.goto(inputUrl, { waitUntil: 'load', timeout: 40_000 });

  // If already on a profile page, done
  if (/linkedin\.com\/in\//.test(page.url())) return true;

  // Search results page — wait for JS render then extract first profile link
  if (inputUrl.includes('/search/results/')) {
    try {
      await page.waitForLoadState('networkidle', { timeout: 12_000 });
    } catch { /* ignore timeout — page may still be usable */ }
    await sleep(2_000);

    // Extract all /in/ links from page, prefer ones inside main content
    const profileUrl: string | null = await page.evaluate(() => {
      const allLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]'));
      const candidates = allLinks
        .map(a => a.href)
        .filter(h => /linkedin\.com\/in\/[^/?]+/.test(h) && !h.includes('/search/'));
      // Prefer links that appear inside the main search results list
      const mainEl = document.querySelector('main') ?? document.body;
      const mainLinks = Array.from(mainEl.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]'))
        .map(a => a.href)
        .filter(h => /linkedin\.com\/in\/[^/?]+/.test(h) && !h.includes('/search/'));
      const source = mainLinks.length > 0 ? mainLinks : candidates;
      return source[0] ?? null;
    });

    if (!profileUrl) {
      // Take debug screenshot
      const debugPath = path.join(ROOT, 'vault', 'imprensa', 'logs',
        `debug_nav_${Date.now()}.png`);
      await page.screenshot({ path: debugPath, fullPage: false });
      return false;
    }

    // Clean URL — remove query params and trailing slashes
    const cleanUrl = profileUrl.split('?')[0].replace(/\/$/, '');
    await page.goto(cleanUrl, { waitUntil: 'load', timeout: 40_000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8_000 }); } catch { /* ok */ }
    await sleep(2_000);
  }

  return /linkedin\.com\/in\//.test(page.url());
}

// ─── modal handler ────────────────────────────────────────────────────────────

async function isInviteModalOpen(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    document.body.textContent?.includes('Adicionar nota ao seu convite') ?? false
  );
}

async function handleInviteModal(page: Page, note: string): Promise<boolean> {
  if (!(await isInviteModalOpen(page))) return false;

  const truncated = note.length > NOTE_CHAR_LIMIT ? note.slice(0, NOTE_CHAR_LIMIT) : note;

  try {
    // Click "Adicionar nota" via JS to bypass any overlay
    const clicked = await page.evaluate(() => {
      for (const btn of document.querySelectorAll<HTMLElement>('button')) {
        if (/^Adicionar nota$/i.test(btn.innerText?.trim() ?? '')) {
          btn.click(); return true;
        }
      }
      return false;
    });

    if (clicked) {
      await sleep(800);
      const textarea = page.locator('textarea').first();
      await textarea.waitFor({ timeout: 4_000 });
      await textarea.fill(truncated);
      await sleep(800);
    }

    // Click send — "Enviar" (with note) or "Enviar sem nota" (fallback)
    const sent = await page.evaluate(() => {
      for (const btn of document.querySelectorAll<HTMLElement>('button')) {
        const text = btn.innerText?.trim() ?? '';
        if (/^Enviar$/i.test(text) || /^Enviar sem nota$/i.test(text)) {
          btn.click(); return true;
        }
      }
      return false;
    });

    await sleep(1_500);
    return sent;
  } catch { return false; }
}

// ─── profile action dispatcher ────────────────────────────────────────────────

async function sendDm(page: Page, message: string): Promise<'message' | 'connect_note' | null> {
  // Guard: must be on a real profile page
  if (!/linkedin\.com\/in\//.test(page.url())) return null;

  // Scroll top + dismiss overlays
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(800);
  await page.keyboard.press('Escape');
  await sleep(400);

  // Check if a modal is already open from a previous attempt
  if (await isInviteModalOpen(page)) {
    const ok = await handleInviteModal(page, message);
    return ok ? 'connect_note' : null;
  }

  // LinkedIn renders duplicate buttons (mobile/desktop breakpoints).
  // Try ALL "Seguir [Name]" buttons — one of them will have "Mais" as a DOM sibling.
  const action = await page.evaluate(() => {
    const followBtns = Array.from(
      document.querySelectorAll('button[aria-label^="Seguir "]')
    ) as HTMLElement[];

    // For each Seguir copy, walk UP the DOM looking for sibling action buttons
    for (const fb of followBtns) {
      let container = fb.parentElement as Element | null;
      for (let d = 0; d < 12; d++) {
        if (!container) break;
        const btns = Array.from(container.querySelectorAll('button')) as HTMLElement[];
        if (btns.length >= 2) {
          for (const btn of btns) {
            if (btn === fb) continue;
            const t = (btn.innerText ?? '').trim();
            const a = btn.getAttribute('aria-label') ?? '';
            if (/^Mensagem$/i.test(t) || /mensagem/i.test(a))   { btn.click(); return 'message'; }
            if (/^Conectar$/i.test(t) || /^conectar$/i.test(a)) { btn.click(); return 'connect'; }
            if (/^Mais$/i.test(t)     || /^Mais$/i.test(a))     { btn.click(); return 'mais';    }
          }
        }
        container = container.parentElement;
      }
    }

    // Fallback: no Seguir — look for direct Mensagem or Conectar anywhere
    const allBtns = Array.from(document.querySelectorAll('button')) as HTMLElement[];
    for (const btn of allBtns) {
      const t = (btn.innerText ?? '').trim(), a = btn.getAttribute('aria-label') ?? '';
      if (/^Mensagem$/i.test(t) || /mensagem/i.test(a))   { btn.click(); return 'message'; }
      if (/^Conectar$/i.test(t) || /^conectar$/i.test(a)) { btn.click(); return 'connect'; }
    }
    return null;
  }) as 'message' | 'connect' | 'mais' | null;

  await sleep(1_200);

  // Modal appeared from Conectar click → handle it
  if (await isInviteModalOpen(page)) {
    const ok = await handleInviteModal(page, message);
    return ok ? 'connect_note' : null;
  }

  // Message compose box appeared
  if (action === 'message') {
    try {
      const compose = page.locator('[contenteditable="true"]').first();
      await compose.waitFor({ timeout: 8_000 });
      await compose.fill(message);
      await sleep(800);
      await page.keyboard.press('Control+Enter');
      await sleep(1_500);
      return 'message';
    } catch { return null; }
  }

  // "Mais" dropdown — find Conectar or Mensagem inside
  if (action === 'mais') {
    const dropAction = await page.evaluate(() => {
      // Use innerText (not textContent) to exclude SVG icon title text
      // Click the li/div parent — not the inner span — so event handlers fire
      const allEls = Array.from(document.querySelectorAll('li, div, a')) as HTMLElement[];
      for (const el of allEls) {
        const text = (el.innerText ?? '').trim();
        if (!text) continue;
        const clickTarget = (el.closest('li') ?? el) as HTMLElement;
        if (/^Mensagem$/i.test(text)) { clickTarget.click(); return 'message'; }
        if (/^Conectar$/i.test(text)) { clickTarget.click(); return 'connect'; }
      }
      return null;
    }) as 'connect' | 'message' | null;

    await sleep(1_200);

    if (await isInviteModalOpen(page)) {
      const ok = await handleInviteModal(page, message);
      return ok ? 'connect_note' : null;
    }

    if (dropAction === 'message') {
      try {
        const compose = page.locator('[contenteditable="true"]').first();
        await compose.waitFor({ timeout: 8_000 });
        await compose.fill(message);
        await sleep(800);
        await page.keyboard.press('Control+Enter');
        await sleep(1_500);
        return 'message';
      } catch { return null; }
    }
  }

  return null;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const DRY_RUN = process.argv.includes('--dry-run');

  const rawTemplate = removeFrontmatter(fs.readFileSync(TEMPLATE_FILE, 'utf-8'));
  const leads: Lead[] = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf-8'));
  const targets = leads.filter(l => CTO_TARGETS.has(l.full_name) && l.linkedin_url?.trim());

  if (targets.length === 0) { console.error('[ERRO] Nenhum CTO-alvo encontrado.'); process.exit(1); }
  if (DRY_RUN) { runDryRun(targets, rawTemplate); return; }

  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  // Kill any existing Chrome instance using this profile — prevents "Abrindo em sessão existente"
  try { execSync('taskkill /F /IM chrome.exe', { stdio: 'ignore' }); } catch { /* ok if none */ }
  await sleep(1_500);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: false,
    viewport: null,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = await ensureLoggedIn(context);
  console.log(`[LINKEDIN DM] ${targets.length} CTOs — iniciando\n`);

  const logs: DmLog[] = [];
  let sent = 0, errors = 0;

  for (let i = 0; i < targets.length; i++) {
    const lead    = targets[i];
    const message = buildMessage(rawTemplate, lead.first_name, lead.company_name);

    console.log(`[${i + 1}/${targets.length}] ${lead.full_name} — ${lead.company_name}`);

    try {
      const reached = await navigateToProfile(page, lead.linkedin_url);
      if (!reached) throw new Error('Perfil não encontrado nos resultados de busca');

      const method = await sendDm(page, message);
      if (!method) {
        const dbg = path.join(ROOT, 'vault', 'imprensa', 'logs',
          `debug_${lead.full_name.replace(/\s+/g, '_')}.png`);
        await page.screenshot({ path: dbg, fullPage: false });
        throw new Error(`Nenhuma ação de envio encontrada no perfil (screenshot: ${path.basename(dbg)})`);
      }

      console.log(`  ✓ Enviada (${method})`);
      logs.push({ name: lead.full_name, company: lead.company_name,
        linkedin_url: lead.linkedin_url, method, status: 'sent',
        sent_at: new Date().toISOString() });
      sent++;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ Erro: ${msg}`);
      logs.push({ name: lead.full_name, company: lead.company_name,
        linkedin_url: lead.linkedin_url, method: 'error', status: 'error',
        error: msg, sent_at: new Date().toISOString() });
      errors++;
    }

    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), 'utf-8');

    if (i < targets.length - 1) {
      console.log(`  Aguardando 60s...\n`);
      await sleep(60_000);
    }
  }

  await context.close();

  console.log('\n[RESUMO LINKEDIN DM]');
  console.log(`  Enviadas : ${sent}`);
  console.log(`  Erros    : ${errors}`);
  console.log(`  Log      : ${LOG_FILE}\n`);
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
