/// <reference lib="dom" />
import { chromium, type Page, type BrowserContext } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT          = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PROFILE_DIR   = path.join(ROOT, '.linkedin-profile');
const TEMPLATE_FILE = path.join(ROOT, 'vault', 'imprensa', 'templates', 'template_futurecom_dm.md');
const LEADS_FILE    = path.join(ROOT, 'data', 'leads', 'futurecom', 'futurecom-event-decision-makers-linkedin-2026-06-12.json');
const today         = new Date().toISOString().split('T')[0];
const LOG_FILE      = path.join(ROOT, 'vault', 'imprensa', 'logs', `linkedin_dm_${today}.json`);

const NOTE_CHAR_LIMIT = 200;
const DAILY_CAP       = 10;   // máximo de ações por dia (DM + conexão somadas)
const DELAY_MIN_MS    = 75_000;
const DELAY_MAX_MS    = 180_000;
const STATE_FILE      = path.join(ROOT, 'vault', 'imprensa', 'logs', 'daily_state.json');

interface Lead {
  name: string; company: string; role: string;
  linkedin_url: string; futurecom_fit?: string; [key: string]: unknown;
}
interface LeadsFile {
  metadata?: Record<string, unknown>;
  contacts:  Lead[];
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

function firstNameOf(fullName: string): string {
  return fullName.split(' ')[0];
}

function buildMessage(template: string, fullName: string, company: string): string {
  return template
    .replace(/\{\{nome\}\}/g, firstNameOf(fullName))
    .replace(/\{\{empresa\}\}/g, company)
    .trim();
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Delay aleatório entre DELAY_MIN e DELAY_MAX (evita timing regular detectável)
function sleepRandom(): Promise<void> {
  const ms = DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS);
  const sec = Math.round(ms / 1000);
  console.log(`  Aguardando ${sec}s antes do próximo...\n`);
  return sleep(ms);
}

// Cap diário — persiste contagem em disco entre execuções do script
interface DailyState { date: string; count: number; }
function loadDailyState(): DailyState {
  const today = new Date().toISOString().split('T')[0];
  try {
    const s: DailyState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    return s.date === today ? s : { date: today, count: 0 };
  } catch { return { date: today, count: 0 }; }
}
function saveDailyState(s: DailyState): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf-8');
}

// Janela comercial — São Paulo (UTC-3), seg-sex, 08h-18h
function isBusinessHours(): boolean {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const day = now.getDay();   // 0=dom, 6=sab
  const h   = now.getHours();
  return day >= 1 && day <= 5 && h >= 8 && h < 18;
}

// Scroll humano — percorre o perfil antes de clicar (comportamento orgânico)
// Tolerates navigation errors — LinkedIn SPA may do soft-nav while scrolling
async function humanScroll(page: Page): Promise<void> {
  const steps = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < steps; i++) {
    const delta = 200 + Math.floor(Math.random() * 300);
    try { await page.evaluate((d) => window.scrollBy(0, d), delta); } catch { break; }
    await sleep(400 + Math.random() * 600);
  }
  try { await page.evaluate(() => window.scrollTo(0, 0)); } catch { /* ok */ }
  await sleep(500);
}

// ─── dry-run ──────────────────────────────────────────────────────────────────

function runDryRun(targets: Lead[], rawTemplate: string): void {
  console.log('\n[DRY-RUN] Nenhuma DM será enviada. Browser não será aberto.\n');
  console.log(`[LINKEDIN DM] ${targets.length} leads encontrados\n`);
  for (let i = 0; i < targets.length; i++) {
    const lead    = targets[i];
    const message = buildMessage(rawTemplate, lead.name, lead.company);
    const fits    = message.length <= NOTE_CHAR_LIMIT;
    console.log(`[${i + 1}/${targets.length}] ${lead.name} — ${lead.company} (${lead.role})`);
    console.log(`  Fit    : ${lead.futurecom_fit ?? 'n/a'}`);
    console.log(`  URL    : ${lead.linkedin_url}`);
    console.log(`  CHARS  : ${message.length} / ${NOTE_CHAR_LIMIT} ${fits ? '✓ cabe em nota' : '⚠️  excede'}`);
    console.log(`  DM     :\n${message.split('\n').map(l => `    ${l}`).join('\n')}`);
    console.log('  ' + '─'.repeat(60));
  }
  console.log('\n[RESUMO DRY-RUN]');
  console.log(`  Modo   : DRY-RUN (browser não aberto, nenhuma DM enviada)`);
  console.log(`  Leads  : ${targets.length} únicos e não enviados\n`);
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
      for (const btn of Array.from(document.querySelectorAll<HTMLElement>('button'))) {
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
      for (const btn of Array.from(document.querySelectorAll<HTMLElement>('button'))) {
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

// Dismiss LinkedIn upsell/Premium modals that block profile interaction
// Retorna true se o modal de upsell Premium estiver visível
async function isPremiumModal(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const text = document.body.textContent ?? '';
    return text.includes('Reative Premium') ||
           text.includes('Envie mensagens a qualquer pessoa com Premium') ||
           text.includes('Experimente o Premium') ||
           text.includes('Try Premium');
  });
}

async function dismissOverlays(page: Page): Promise<void> {
  // Fecha modal Premium primeiro — é o mais comum e bloqueia tudo
  if (await isPremiumModal(page)) {
    await page.evaluate(() => {
      // Tenta botão "Fechar" / × dentro do modal Premium
      for (const btn of Array.from(document.querySelectorAll<HTMLElement>('button'))) {
        const label = btn.getAttribute('aria-label') ?? '';
        const text  = btn.innerText?.trim() ?? '';
        if (/fechar|close|×|✕/i.test(label) || /fechar|close/i.test(text)) {
          btn.click(); return;
        }
      }
      // Fallback: esconde todos os dialogs
      document.querySelectorAll<HTMLElement>('[role="dialog"], .artdeco-modal-overlay, .premium-upsell-modal')
        .forEach(el => { el.style.display = 'none'; });
      document.body.style.overflow = '';
    });
    await sleep(600);
    return;
  }

  // Seletores padrão (sem Escape — pode disparar back-navigation no LinkedIn)
  for (const sel of [
    'button.artdeco-modal__dismiss',
    'button[aria-label="Fechar"]',
    'button[aria-label="Fechar pop-up"]',
    '[data-test-modal-close-btn]',
  ]) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 600 })) { await btn.click(); await sleep(500); return; }
    } catch { /* not present */ }
  }

  // Botão × — primeiro botão pequeno no header do dialog
  await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (dialog) {
      const dRect = dialog.getBoundingClientRect();
      const closeBtn = dRect.width > 0
        ? Array.from(dialog.querySelectorAll<HTMLElement>('button')).find(b => {
            const r = b.getBoundingClientRect();
            return r.width > 0 && r.width < 60 && r.top < dRect.top + 120;
          })
        : null;
      if (closeBtn) { closeBtn.click(); return; }
    }
    document.querySelectorAll<HTMLElement>('[role="dialog"], .artdeco-modal-overlay, .overlay--fade-in')
      .forEach(el => { el.style.display = 'none'; });
    document.body.style.overflow = '';
  });
  await sleep(800);
}

async function sendDm(page: Page, message: string): Promise<'message' | 'connect_note' | null> {
  if (!/linkedin\.com\/in\//.test(page.url())) return null;

  try { await page.evaluate(() => window.scrollTo(0, 0)); } catch { /* ok */ }
  await sleep(800);
  try { await dismissOverlays(page); } catch { /* ok */ }
  await sleep(1_500);

  if (await isInviteModalOpen(page)) {
    const ok = await handleInviteModal(page, message);
    return ok ? 'connect_note' : null;
  }

  const sendMessage = async (): Promise<boolean> => {
    try {
      const compose = page.locator('[contenteditable="true"]').first();
      await compose.waitFor({ timeout: 8_000 });
      await compose.fill(message);
      await sleep(800);
      await page.keyboard.press('Control+Enter');
      await sleep(1_500);
      return true;
    } catch { return false; }
  };

  const waitForModal = async (ms = 4_000): Promise<boolean> => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await isInviteModalOpen(page)) return true;
      await sleep(300);
    }
    return false;
  };

  // ── Detecta se é 1º grau pela AUSÊNCIA do botão "Conectar" na área do perfil ───
  // Limita à metade esquerda da página para ignorar sidebar de sugestões
  const hasConectarBtn = await page.evaluate(() => {
    const win = window.innerWidth;
    for (const btn of Array.from(document.querySelectorAll<HTMLElement>('button'))) {
      const rect = btn.getBoundingClientRect();
      if (rect.width === 0) continue;
      if (rect.left >= win * 0.6) continue; // ignora sidebar direita
      const text = (btn.innerText ?? '').trim().split('\n')[0].trim().toLowerCase();
      const aria = (btn.getAttribute('aria-label') ?? '').toLowerCase();
      if (text === 'conectar' || aria === 'conectar' || aria.includes('convidar')) return true;
    }
    return false;
  });

  // ── 1º grau: "Enviar mensagem" direto — 3 estratégias + debug dump ───────────
  if (!hasConectarBtn) {
    console.log('  [INFO] Sem botão Conectar — tratando como 1º grau');
    let msgClicked = false;

    // Estratégia A: aria-label via Playwright locator
    for (const sel of [
      'button[aria-label*="Enviar mensagem"]',
      'button[aria-label*="mensagem"]',
      'button[aria-label*="Message"]',
    ]) {
      if (msgClicked) break;
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1_500 })) {
          await btn.click(); msgClicked = true;
          console.log(`  [DEBUG] Mensagem: clicou via aria-label: ${sel}`);
        }
      } catch { /* next */ }
    }

    // Estratégia B: texto visível via Playwright locator
    if (!msgClicked) {
      try {
        const btn = page.locator('button').filter({ hasText: /^Enviar mensagem$|^Mensagem$/i }).first();
        if (await btn.isVisible({ timeout: 1_500 })) {
          await btn.click(); msgClicked = true;
          console.log('  [DEBUG] Mensagem: clicou via text filter');
        }
      } catch { /* next */ }
    }

    // Estratégia C: evaluate — qualquer botão com "mensagem" em label ou texto
    if (!msgClicked) {
      msgClicked = await page.evaluate(() => {
        for (const btn of Array.from(document.querySelectorAll<HTMLElement>('button'))) {
          if (btn.getBoundingClientRect().width === 0) continue;
          const label = (btn.getAttribute('aria-label') ?? '').toLowerCase();
          const text  = (btn.innerText ?? '').trim().split('\n')[0].trim().toLowerCase();
          if (label.includes('mensagem') || label.includes('message') ||
              text === 'mensagem' || text === 'enviar mensagem') {
            btn.click(); return true;
          }
        }
        return false;
      });
      if (msgClicked) console.log('  [DEBUG] Mensagem: clicou via evaluate fallback');
    }

    // Debug dump se nenhuma estratégia funcionou
    if (!msgClicked) {
      const btns = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('button'))
          .filter(b => b.getBoundingClientRect().width > 0)
          .map(b => ({
            text: (b.innerText ?? '').trim().slice(0, 60).replace(/\n/g, '|'),
            aria: b.getAttribute('aria-label'),
          }))
      );
      console.log('  [DEBUG] Botões visíveis no perfil:', JSON.stringify(btns));
      return null;
    }

    await sleep(1_500);
    try { await dismissOverlays(page); } catch { /* ok */ }
    if (await isPremiumModal(page)) { await dismissOverlays(page); return null; }
    await sleep(500);
    if (await sendMessage()) return 'message';
    return null;
  }

  // ── 2º/3º grau: Conectar → Mais ──────────────────────────────────────────────

  const profileActionBtn = (textRe: RegExp, ariaRe?: RegExp): Promise<boolean> =>
    page.evaluate(({ ts, tf, as_, af }) => {
      const tp = new RegExp(ts, tf);
      const ap = as_ ? new RegExp(as_, af ?? '') : null;
      const ACTION_RE = /^(conectar|mensagem|seguir|enviar mensagem|mais)$/i;
      for (const btn of Array.from(document.querySelectorAll<HTMLElement>('button'))) {
        if (btn.getBoundingClientRect().width === 0) continue;
        const t = (btn.innerText ?? '').trim().split('\n')[0].trim();
        const a = btn.getAttribute('aria-label') ?? '';
        if (!tp.test(t) && !(ap && ap.test(a))) continue;
        let node: HTMLElement | null = btn.parentElement;
        for (let i = 0; i < 4 && node; i++, node = node.parentElement) {
          const siblings = Array.from(node.querySelectorAll<HTMLElement>('button'));
          const actionCount = siblings.filter(s =>
            ACTION_RE.test((s.innerText ?? '').trim().split('\n')[0])
          ).length;
          if (actionCount >= 2) { btn.click(); return true; }
        }
      }
      const win = window.innerWidth;
      for (const btn of Array.from(document.querySelectorAll<HTMLElement>('button'))) {
        const rect = btn.getBoundingClientRect();
        if (rect.width === 0 || rect.left >= win * 0.75) continue;
        const t = (btn.innerText ?? '').trim().split('\n')[0].trim();
        const a = btn.getAttribute('aria-label') ?? '';
        if (tp.test(t) || (ap && ap.test(a))) { btn.click(); return true; }
      }
      return false;
    }, { ts: textRe.source, tf: textRe.flags, as_: ariaRe?.source, af: ariaRe?.flags });

  const jsDropItem = async (textRe: RegExp): Promise<boolean> => {
    const result = await page.evaluate(({ ts, tf }) => {
      const tp = new RegExp(ts, tf);
      const menuCandidates = Array.from(document.querySelectorAll<HTMLElement>(
        '[role="menu"], [role="listbox"], .artdeco-dropdown__content, .pvs-overflow-actions-dropdown__content, [data-view-name="overflow-menu"]'
      ));
      const debug: string[] = [];
      for (const menu of menuCandidates) {
        const rect = menu.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        debug.push(`menu:${menu.tagName}[${menu.getAttribute('role')||''}] h=${rect.height}`);
        for (const el of Array.from(menu.querySelectorAll<HTMLElement>('*'))) {
          const t = (el.innerText ?? '').trim().split('\n')[0].trim();
          if (tp.test(t)) {
            const target = el.closest<HTMLElement>('li, [role="menuitem"], [role="option"]') ?? el;
            target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            target.click();
            return { clicked: true, debug };
          }
        }
      }
      return { clicked: false, debug };
    }, { ts: textRe.source, tf: textRe.flags });
    console.log(`  [DEBUG] jsDropItem(${textRe}) → ${result.clicked} | menus: ${JSON.stringify(result.debug)}`);
    return result.clicked;
  };

  const isProfileActionsDropdown = (): Promise<boolean> =>
    page.evaluate(() => {
      for (const menu of Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]'))) {
        if (menu.getBoundingClientRect().height === 0) continue;
        for (const el of Array.from(menu.querySelectorAll<HTMLElement>('*'))) {
          const t = (el.innerText ?? '').trim().toLowerCase();
          if (t === 'conectar' || t === 'mensagem') return true;
        }
      }
      return false;
    });

  // Step 1: botão "Conectar" direto
  const connDirect = await profileActionBtn(/^conectar$/i, /^conectar$/i).catch(() => false);
  if (connDirect) {
    await sleep(800);
    if (await waitForModal(4_000)) {
      const ok = await handleInviteModal(page, message);
      if (ok) return 'connect_note';
    }
  }

  // Step 2: dropdown "Mais" → Conectar ou Mensagem
  const maisOpened = await profileActionBtn(/^mais$/i, /^mais$/i).catch(() => false);
  if (maisOpened) {
    await sleep(1_000);

    if (await isInviteModalOpen(page)) {
      const ok = await handleInviteModal(page, message);
      if (ok) return 'connect_note';
    }

    if (!(await isProfileActionsDropdown())) {
      console.log('  [DEBUG] Dropdown secundário detectado (sem Conectar/Mensagem) — fechando');
      try { await page.keyboard.press('Escape'); } catch { /* ok */ }
      await sleep(500);
    } else {
      const connInDrop = await (async () => {
        try {
          const item = page.locator('[role="menu"]').locator(':text-matches("^Conectar$", "i")').first();
          if (await item.isVisible({ timeout: 2_500 })) { await item.click(); return true; }
        } catch { /* ok */ }
        return await jsDropItem(/^conectar$/i).catch(() => false);
      })();
      if (connInDrop) {
        await sleep(800);
        if (await waitForModal(4_000)) {
          const ok = await handleInviteModal(page, message);
          if (ok) return 'connect_note';
        }
      }

      const msgInDrop = await jsDropItem(/^mensagem$/i).catch(() => false);
      if (msgInDrop) {
        await sleep(1_200);
        try { await dismissOverlays(page); } catch { /* ok */ }
        await sleep(500);
        if (await sendMessage()) return 'message';
      }
    }
  }

  return null;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const DRY_RUN = process.argv.includes('--dry-run');

  const limitRaw  = process.argv.find(a => a.startsWith('--limit='))?.split('=')[1]
                 ?? process.argv[process.argv.indexOf('--limit') + 1];
  const offsetRaw = process.argv.find(a => a.startsWith('--offset='))?.split('=')[1]
                 ?? process.argv[process.argv.indexOf('--offset') + 1];
  const LIMIT  = limitRaw  && !isNaN(Number(limitRaw))  ? Number(limitRaw)  : Infinity;
  const OFFSET = offsetRaw && !isNaN(Number(offsetRaw)) ? Number(offsetRaw) : 0;

  const rawTemplate = removeFrontmatter(fs.readFileSync(TEMPLATE_FILE, 'utf-8'));
  const leadsFile: LeadsFile = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf-8'));

  // Carrega URLs já enviadas em QUALQUER log do dia para evitar reenvio em re-execuções
  const alreadySent = new Set<string>();
  if (fs.existsSync(LOG_FILE)) {
    try {
      const existing: DmLog[] = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
      existing.filter(l => l.status === 'sent').forEach(l => alreadySent.add(l.linkedin_url));
    } catch { /* ignora log corrompido */ }
  }

  // Deduplica por URL e exclui já enviados
  const seen = new Set<string>();
  const allTargets = leadsFile.contacts.filter(l => {
    const url = l.linkedin_url?.trim();
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return !alreadySent.has(url);
  });

  if (alreadySent.size > 0)
    console.log(`[SKIP] ${alreadySent.size} leads já enviados hoje — pulados\n`);

  const sliced = OFFSET > 0 ? allTargets.slice(OFFSET) : allTargets;
  const targets = isFinite(LIMIT) ? sliced.slice(0, LIMIT) : sliced;

  if (targets.length === 0) { console.error('[ERRO] Nenhum CTO-alvo encontrado.'); process.exit(1); }
  if (LIMIT < Infinity || OFFSET > 0) console.log(`[LIMIT] Modo de teste — offset ${OFFSET}, processando ${targets.length} de ${allTargets.length} leads\n`);
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

  // ── Proteção 1: janela comercial ────────────────────────────────────────────
  if (!isBusinessHours()) {
    console.error('[BLOQUEIO] Fora da janela comercial (seg-sex 08h-18h Brasília). Abortando.');
    await context.close();
    process.exit(0);
  }

  // ── Proteção 2: cap diário ───────────────────────────────────────────────────
  const dailyState = loadDailyState();
  if (dailyState.count >= DAILY_CAP) {
    console.error(`[BLOQUEIO] Cap diário atingido (${DAILY_CAP} ações). Retome amanhã.`);
    await context.close();
    process.exit(0);
  }
  const remaining = DAILY_CAP - dailyState.count;
  console.log(`[PROTEÇÃO] Cap diário: ${dailyState.count}/${DAILY_CAP} usados — ${remaining} disponíveis hoje`);

  const page = await ensureLoggedIn(context);
  const capped = targets.slice(0, remaining);
  console.log(`[LINKEDIN DM] ${capped.length} leads nesta sessão (de ${targets.length} totais)\n`);

  // Carrega entradas anteriores para preservar histórico entre execuções do dia
  const logs: DmLog[] = fs.existsSync(LOG_FILE) ? (() => {
    try { return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8')); } catch { return []; }
  })() : [];
  let sent = 0, errors = 0;

  for (let i = 0; i < capped.length; i++) {
    // ── Proteção 3: re-verificar janela comercial a cada lead ─────────────────
    if (!isBusinessHours()) {
      console.log('[PROTEÇÃO] Saiu da janela comercial. Pausando sessão.');
      break;
    }

    const lead    = capped[i];
    const message = buildMessage(rawTemplate, lead.name, lead.company);

    console.log(`[${i + 1}/${capped.length}] ${lead.name} — ${lead.company} (${lead.role})`);

    try {
      const reached = await navigateToProfile(page, lead.linkedin_url);
      if (!reached) throw new Error('Perfil não encontrado nos resultados de busca');

      // ── Proteção 4: scroll humano antes de agir ───────────────────────────
      await humanScroll(page);

      // Re-check URL after scroll — LinkedIn SPA may have soft-navigated
      try { await page.waitForLoadState('networkidle', { timeout: 5_000 }); } catch { /* ok */ }
      if (!/linkedin\.com\/in\//.test(page.url())) {
        console.log(`  Re-navegando para ${lead.linkedin_url} após redirecionamento...`);
        await page.goto(lead.linkedin_url, { waitUntil: 'load', timeout: 40_000 });
        await sleep(2_000);
      }

      const method = await sendDm(page, message);
      if (!method) {
        const dbg = path.join(ROOT, 'vault', 'imprensa', 'logs',
          `debug_${lead.name.replace(/\s+/g, '_')}.png`);
        await page.screenshot({ path: dbg, fullPage: false });
        throw new Error(`Nenhuma ação de envio encontrada no perfil (screenshot: ${path.basename(dbg)})`);
      }

      console.log(`  ✓ Enviada (${method})`);
      logs.push({ name: lead.name, company: lead.company,
        linkedin_url: lead.linkedin_url, method, status: 'sent',
        sent_at: new Date().toISOString() });
      sent++;
      dailyState.count++;
      saveDailyState(dailyState);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ Erro: ${msg}`);
      logs.push({ name: lead.name, company: lead.company,
        linkedin_url: lead.linkedin_url, method: 'error', status: 'error',
        error: msg, sent_at: new Date().toISOString() });
      errors++;
    }

    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), 'utf-8');

    // ── Proteção 5: delay aleatório entre envios (75-180s) ────────────────────
    if (i < capped.length - 1) await sleepRandom();
  }

  await context.close();

  console.log('\n[RESUMO LINKEDIN DM]');
  console.log(`  Enviadas : ${sent}`);
  console.log(`  Erros    : ${errors}`);
  console.log(`  Cap hoje : ${dailyState.count}/${DAILY_CAP}`);
  console.log(`  Log      : ${LOG_FILE}\n`);
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
