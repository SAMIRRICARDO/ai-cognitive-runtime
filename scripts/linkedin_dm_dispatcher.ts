/// <reference lib="dom" />
import { chromium, type Page, type BrowserContext } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { analyzeProfile, closeFloatingChats } from '../agents/linkedin/profile-analyzer.js';
import { LeadStateMachine } from '../agents/linkedin/lead-state-machine.js';
import { selectStrategy, type ExecutionStrategy } from '../agents/linkedin/strategy-agent.js';

const ROOT          = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PROFILE_DIR   = path.join(ROOT, '.linkedin-profile');
const TEMPLATE_FILE = path.join(ROOT, 'vault', 'imprensa', 'templates', 'template_futurecom_dm.md');
const LEADS_FILE    = path.join(ROOT, 'data', 'leads', 'futurecom', 'futurecom-event-decision-makers-linkedin-2026-06-12.json');
const today         = new Date().toISOString().split('T')[0];
const LOG_FILE      = path.join(ROOT, 'vault', 'imprensa', 'logs', `linkedin_dm_${today}.json`);
const LEAD_STATE_FILE = path.join(ROOT, 'data', 'linkedin', 'lead-states.json');

const NOTE_CHAR_LIMIT = 200;
const DAILY_CAP       = 10;
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
  method: 'message' | 'connect_note' | 'error' | 'unreachable';
  status: 'sent' | 'error' | 'skipped'; error?: string; sent_at: string;
}

// ─── Structured logger (sem dependência de env.ts / ANTHROPIC_API_KEY) ────────
import { createLogger, format, transports } from 'winston';

const log = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
  transports: [
    new transports.Console({ format: format.combine(format.colorize(), format.simple()) }),
    new transports.File({
      filename: path.join(ROOT, 'vault', 'imprensa', 'logs', `dispatcher_${today}.log`),
      format: format.json(),
    }),
  ],
});

// ─── Utils ────────────────────────────────────────────────────────────────────

function removeFrontmatter(content: string): string {
  if (content.trimStart().startsWith('---')) {
    const start = content.indexOf('---');
    const end   = content.indexOf('---', start + 3);
    if (end !== -1) return content.slice(end + 3).trimStart();
  }
  return content;
}

function buildMessage(template: string, fullName: string, company: string): string {
  return template
    .replace(/\{\{nome\}\}/g, fullName.split(' ')[0])
    .replace(/\{\{empresa\}\}/g, company)
    .trim();
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Delay baseado no resultado — não espera o máximo quando não houve ação real
function smartDelay(strategy: ExecutionStrategy, success: boolean): Promise<void> {
  let ms: number;
  if (strategy === 'SEND_DIRECT_MESSAGE' || strategy === 'SEND_CONNECTION_NOTE') {
    if (success) {
      // Ação real — delay longo para comportamento humano
      ms = DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS);
    } else {
      // Tentativa falhou — delay curto
      ms = 5_000 + Math.random() * 10_000;
    }
  } else {
    // Skip — sem delay significativo
    ms = 1_500 + Math.random() * 2_000;
  }
  if (ms > 5_000) {
    const sec = Math.round(ms / 1000);
    console.log(`  Aguardando ${sec}s antes do próximo...`);
  }
  return sleep(ms);
}

// ─── Safe element helpers (PDF: safeFindElement + safeClick) ─────────────────

async function safeFindElement(
  page: Page,
  selectors: string[],
  timeoutMs = 5_000
): Promise<import('playwright').Locator | null> {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: 'visible', timeout: timeoutMs });
      return loc;
    } catch { /* tenta próximo seletor */ }
  }
  return null;
}

async function safeClick(
  page: Page,
  selectors: string[],
  timeoutMs = 5_000
): Promise<boolean> {
  const el = await safeFindElement(page, selectors, timeoutMs);
  if (!el) return false;
  try { await el.click({ timeout: timeoutMs }); return true; }
  catch { return false; }
}

// ─── Daily cap ────────────────────────────────────────────────────────────────

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

// ─── Business hours ───────────────────────────────────────────────────────────

function isBusinessHours(): boolean {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const day = now.getDay();
  const h   = now.getHours();
  return day >= 1 && day <= 5 && h >= 8 && h < 18;
}

// ─── Human scroll ────────────────────────────────────────────────────────────

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

// ─── Login guard ──────────────────────────────────────────────────────────────

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

// ─── Navigation ───────────────────────────────────────────────────────────────

async function navigateToProfile(page: Page, inputUrl: string): Promise<boolean> {
  await page.goto(inputUrl, { waitUntil: 'load', timeout: 40_000 });

  if (/linkedin\.com\/in\//.test(page.url())) return true;

  if (inputUrl.includes('/search/results/')) {
    try { await page.waitForLoadState('networkidle', { timeout: 12_000 }); } catch { /* ok */ }
    await sleep(2_000);

    const profileUrl: string | null = await page.evaluate(() => {
      const mainEl = document.querySelector('main') ?? document.body;
      const links = Array.from(mainEl.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]'))
        .map(a => a.href)
        .filter(h => /linkedin\.com\/in\/[^/?]+/.test(h) && !h.includes('/search/'));
      return links[0] ?? null;
    });

    if (!profileUrl) {
      const dbgPath = path.join(ROOT, 'vault', 'imprensa', 'logs', `debug_nav_${Date.now()}.png`);
      await page.screenshot({ path: dbgPath, fullPage: false });
      return false;
    }

    const cleanUrl = profileUrl.split('?')[0].replace(/\/$/, '');
    await page.goto(cleanUrl, { waitUntil: 'load', timeout: 40_000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8_000 }); } catch { /* ok */ }
    await sleep(2_000);
  }

  return /linkedin\.com\/in\//.test(page.url());
}

// ─── Premium modal detector ───────────────────────────────────────────────────
// Escopo restrito a dialogs visíveis — LinkedIn tem texto Premium em TODA sidebar

// InMail/Premium detectado SOMENTE dentro de dialogs visíveis — não varre document.body
// \binmail\b é seguro: a palavra "InMail" não aparece em sidebars/banners fora de modais
async function isPremiumModal(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const PREMIUM_RE = /\bpremium\b|\binmail\b/i;
    const sels = [
      '[role="dialog"]:not([aria-hidden="true"])',
      '[role="alertdialog"]',
      '.artdeco-modal',
      '.premium-upsell-modal',
      '[data-test-premium-upsell-modal]',
    ];
    for (const sel of sels) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        if (el.getBoundingClientRect().height < 50) continue;
        if (PREMIUM_RE.test(el.textContent ?? '')) return true;
      }
    }
    // Fallback: botão de upgrade/desconto do Premium (único ao modal de upsell)
    // Captura: "Realize Premium", "Realizar Premium", "Reativar Premium", "Realize Premium: 50% de desconto" etc.
    return Array.from(document.querySelectorAll<HTMLElement>('button, a')).some(function(el) {
      const t = (el.innerText ?? '').trim().toLowerCase();
      const rect = el.getBoundingClientRect();
      if (rect.height === 0) return false;
      // premium + desconto: exclusivo do upsell modal (ex: "Realize Premium: 50% de desconto")
      if (t.includes('premium') && (t.includes('desconto') || t.includes('discount'))) return true;
      // Variações do botão de ação premium (realiz*, ativ*, obter, try, get)
      return /\breal[ia]z/i.test(t) && /\bpremium\b/i.test(t) ||
             t.includes('reativar premium') || t.includes('experimente premium') ||
             t.includes('try premium') || t.includes('get premium') ||
             t.includes('obter premium') || t.includes('assinar premium');
    });
  });
}

// ─── Invite modal ─────────────────────────────────────────────────────────────

// Usa Playwright locators que pierciam Shadow DOM — page.evaluate() não vê shadow roots
async function isInviteModalOpen(page: Page): Promise<boolean> {
  try {
    // Detecta pelos botões exclusivos do modal de convite do LinkedIn
    const addNote   = page.getByRole('button', { name: /^Adicionar nota$/i });
    const sendNoNote = page.getByRole('button', { name: /^Enviar sem nota$/i });
    const addNoteEn = page.getByRole('button', { name: /^Add a note$/i });
    if (await addNote.isVisible({ timeout: 200 }))    return true;
    if (await sendNoNote.isVisible({ timeout: 200 })) return true;
    if (await addNoteEn.isVisible({ timeout: 200 }))  return true;
  } catch { /* ok */ }
  // Fallback: texto da página via Playwright (também pierca shadow DOM)
  try {
    const title = page.getByText('Adicionar nota ao seu convite', { exact: false });
    if (await title.isVisible({ timeout: 200 })) return true;
  } catch { /* ok */ }
  return false;
}

async function handleInviteModal(page: Page, note: string): Promise<boolean> {
  if (!(await isInviteModalOpen(page))) return false;

  const truncated = note.length > NOTE_CHAR_LIMIT ? note.slice(0, NOTE_CHAR_LIMIT) : note;

  try {
    // Passo 1: clica "Adicionar nota" se visível (Phase 1 modal)
    const addNoteBtn = page.getByRole('button', { name: /^Adicionar nota$/i });
    const addNoteVisible = await addNoteBtn.isVisible({ timeout: 1_000 }).catch(() => false);
    log.debug('linkedin.handle_invite.addNote', { visible: addNoteVisible });
    if (addNoteVisible) {
      await addNoteBtn.click();
      await sleep(1_200); // aguarda transição para Phase 2
    }

    // Passo 2: preenche textarea (Phase 2 modal)
    const textarea = page.locator('textarea').first();
    const taVisible = await textarea.isVisible({ timeout: 5_000 }).catch(() => false);
    log.debug('linkedin.handle_invite.textarea', { visible: taVisible });
    if (taVisible) {
      await textarea.fill(truncated);
      await sleep(600);
    }

    // Passo 3: clica o botão "Enviar" do Phase 2 via DOM regular (page.evaluate funciona aqui)
    // Não usar Playwright locator: "Enviar sem nota" do Phase 1 fica atrás do Phase 2 no DOM
    // causando timeout de 30s no locator.click() por elemento coberto
    const sentViaEval = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll<HTMLElement>('button'));
      for (const btn of buttons) {
        const t = (btn.innerText ?? '').trim();
        const rect = btn.getBoundingClientRect();
        if (rect.height === 0 || rect.width === 0) continue;
        // Corresponde APENAS a "Enviar" exato (não "Enviar sem nota", "Cancelar" etc.)
        if (/^(enviar|send|enviar convite|send invite)$/i.test(t)) {
          btn.click();
          return { sent: true, btn: t };
        }
      }
      return { sent: false, btn: '' };
    });
    log.debug('linkedin.handle_invite.evalSend', sentViaEval);
    if (sentViaEval.sent) {
      await sleep(1_500);
      return true;
    }

    // Fallback: teclado (submete o form com Enter enquanto textarea está focada)
    log.debug('linkedin.handle_invite.keyboard_fallback');
    if (taVisible) {
      await textarea.press('Enter'); // não submete textarea multiline mas força blur/confirm
      await sleep(300);
    }
    await page.keyboard.press('Control+Enter');
    await sleep(1_500);
    return true; // assume enviado (fallback de último recurso)

  } catch (e) {
    log.debug('linkedin.handle_invite.exception', { err: String(e).slice(0, 120) });
    return false;
  }
}

// ─── Dismiss overlays ────────────────────────────────────────────────────────

async function dismissOverlays(page: Page): Promise<void> {
  if (await isPremiumModal(page)) {
    await page.evaluate(() => {
      for (const btn of Array.from(document.querySelectorAll<HTMLElement>('button'))) {
        const label = btn.getAttribute('aria-label') ?? '';
        const text  = btn.innerText?.trim() ?? '';
        if (/fechar|close|×|✕/i.test(label) || /fechar|close/i.test(text)) {
          btn.click(); return;
        }
      }
      document.querySelectorAll<HTMLElement>('[role="dialog"], .artdeco-modal-overlay, .premium-upsell-modal')
        .forEach(el => { el.style.display = 'none'; });
      document.body.style.overflow = '';
    });
    await sleep(600);
    return;
  }

  const closed = await safeClick(page, [
    'button.artdeco-modal__dismiss',
    'button[aria-label="Fechar"]',
    'button[aria-label="Fechar pop-up"]',
    '[data-test-modal-close-btn]',
  ], 600);
  if (closed) { await sleep(500); return; }

  await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (dialog) {
      const dRect = dialog.getBoundingClientRect();
      const closeBtn = Array.from(dialog.querySelectorAll<HTMLElement>('button')).find(b => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.width < 60 && r.top < dRect.top + 120;
      });
      if (closeBtn) { closeBtn.click(); return; }
    }
    document.querySelectorAll<HTMLElement>('[role="dialog"], .artdeco-modal-overlay, .overlay--fade-in')
      .forEach(el => { el.style.display = 'none'; });
    document.body.style.overflow = '';
  });
  await sleep(800);
}

// ─── Executor: mensagem direta (1º grau) ─────────────────────────────────────

async function executeSendDirectMessage(page: Page, message: string): Promise<boolean> {
  // Clica no botão Mensagem — exclui containers de chat flutuante via DOM
  const clicked = await page.evaluate(() => {
    const CHAT_SELS = [
      '.msg-overlay-conversation-bubble',
      '.msg-overlay-list-bubble',
      '#msg-overlay',
      '[data-view-name="messaging-overlay"]',
    ];
    const win = window.innerWidth;
    for (const btn of Array.from(document.querySelectorAll<HTMLElement>('button'))) {
      const rect = btn.getBoundingClientRect();
      if (rect.width === 0 || rect.left >= win * 0.75) continue;
      if (CHAT_SELS.some(function(s) { return btn.closest(s) !== null; })) continue;
      const label = (btn.getAttribute('aria-label') ?? '').toLowerCase();
      const text  = (btn.innerText ?? '').trim().split('\n')[0].trim().toLowerCase();
      if (label.includes('mensagem') || label.includes('message') ||
          text === 'mensagem' || text === 'enviar mensagem') {
        btn.click(); return true;
      }
    }
    return false;
  });

  if (!clicked) {
    // Fallback: Playwright locator
    const btn = await safeFindElement(page, [
      'button:has-text("Enviar mensagem")',
      'button:has-text("Mensagem")',
    ], 2_000);
    if (btn) { await btn.click(); }
    else { return false; }
  }

  await sleep(2_000);

  // Caso 1: LinkedIn redirecionou para página de assinatura Premium (sem dialog)
  // Acontece quando perfil exige InMail — clique em "Mensagem" leva para /premium/
  const urlAfterClick = page.url();
  if (!/linkedin\.com\/in\//.test(urlAfterClick)) {
    log.warn('linkedin.redirect.premium_page', { url: urlAfterClick });
    // Volta ao perfil para o próximo lead poder navegar normalmente
    await page.goBack({ timeout: 10_000 }).catch(function() { /* ok */ });
    throw new Error('INMAIL_PREMIUM_REQUIRED');
  }

  // Caso 2: dialog Premium/InMail aberto (não houve navegação, mas bloqueou)
  if (await isInviteModalOpen(page)) {
    log.info('linkedin.modal.invite_note', { action: 'enviando nota de convite' });
    return handleInviteModal(page, message);
  }

  if (await isPremiumModal(page)) {
    log.warn('linkedin.modal.inmail', { action: 'InMail Premium detectado — sem canal gratuito' });
    await dismissOverlays(page);
    throw new Error('INMAIL_PREMIUM_REQUIRED');
  }

  // Busca campo de texto SOMENTE dentro de overlay ativo — nunca o primeiro da página
  const compose = await safeFindElement(page, [
    '.msg-overlay-conversation-bubble--is-active [contenteditable="true"]',
    '.msg-form__contenteditable[contenteditable="true"]',
    '[role="dialog"] [contenteditable="true"]',
    '.msg-overlay-list-bubble [contenteditable="true"]',
    '.msg-overlay-conversation-bubble [contenteditable="true"]',
  ], 8_000);

  if (!compose) {
    // Modal Premium pode ter aparecido com delay > 2s — checa novamente antes de falhar
    if (await isPremiumModal(page)) {
      await dismissOverlays(page);
      throw new Error('INMAIL_PREMIUM_REQUIRED');
    }
    return false;
  }

  await compose.fill(message);
  await sleep(800);
  await page.keyboard.press('Control+Enter');
  await sleep(1_500);
  return true;
}

// ─── Executor: convite com nota (2º/3º grau) ─────────────────────────────────

async function executeSendConnectionNote(page: Page, message: string): Promise<boolean> {
  const waitForInviteModal = async (ms = 4_000): Promise<boolean> => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await isInviteModalOpen(page)) return true;
      await sleep(300);
    }
    return false;
  };

  const profileActionBtn = (textRe: RegExp, ariaRe?: RegExp): Promise<boolean> =>
    page.evaluate(({ ts, tf, as_, af }) => {
      const tp = new RegExp(ts, tf);
      const ap = as_ ? new RegExp(as_, af ?? '') : null;
      const ACTION_RE = /^(conectar|mensagem|seguir|enviar mensagem|[…\s]*mais)$/i;
      for (const btn of Array.from(document.querySelectorAll<HTMLElement>('button'))) {
        if (btn.getBoundingClientRect().width === 0) continue;
        const t = (btn.innerText ?? '').trim().split('\n')[0].trim();
        const a = btn.getAttribute('aria-label') ?? '';
        if (!tp.test(t) && !(ap && ap.test(a))) continue;
        let node: HTMLElement | null = btn.parentElement;
        for (let i = 0; i < 4 && node; i++, node = node.parentElement) {
          const siblings = Array.from(node.querySelectorAll<HTMLElement>('button'));
          if (siblings.filter(s => ACTION_RE.test((s.innerText ?? '').trim().split('\n')[0])).length >= 2) {
            btn.click(); return true;
          }
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
        '[role="menu"], [role="listbox"], .artdeco-dropdown__content, ' +
        '.pvs-overflow-actions-dropdown__content, [data-view-name="overflow-menu"]'
      ));
      const debug: string[] = [];
      for (const menu of menuCandidates) {
        const rect = menu.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        debug.push(`menu:${menu.tagName}[${menu.getAttribute('role') || ''}] h=${rect.height}`);
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
    log.debug('linkedin.dropdown', { pattern: textRe.toString(), clicked: result.clicked, menus: result.debug });
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

  // Verifica se o convite foi enviado diretamente (botão mudou para "Pendente")
  const checkSentDirectly = async (): Promise<boolean> =>
    page.evaluate(() => {
      return Array.from(document.querySelectorAll<HTMLElement>('button')).some(function(b) {
        const t = (b.innerText ?? '').trim().toLowerCase();
        return t.includes('pendente') || t.includes('pending');
      }) || (document.body.textContent ?? '').includes('Convite enviado');
    });

  // Helper: espera modal e tenta handle — usado em ambas as branches abaixo
  const waitAndHandle = async (): Promise<boolean> => {
    // Janela primária: 10s (modal pode levar >7s para aparecer após rate limiting do LinkedIn)
    if (await waitForInviteModal(10_000)) {
      const ok = await handleInviteModal(page, message);
      if (ok) return true;
    }
    // Checagem tardia 1: imediatamente após janela primária
    if (await isInviteModalOpen(page)) {
      const ok = await handleInviteModal(page, message);
      if (ok) return true;
    }
    // Aguarda mais 4s (total ~15s desde o clique) — LinkedIn pode ter delay >10s
    await sleep(4_000);
    // Checagem tardia 2: após sleep adicional (cobre o caso observado de ~11s de delay)
    if (await isInviteModalOpen(page)) {
      const ok = await handleInviteModal(page, message);
      if (ok) return true;
    }
    if (await checkSentDirectly()) return true;
    return false;
  };

  // Tenta botão "Conectar" direto — primeiro via Playwright locators (pierciam Shadow DOM)
  // page.evaluate(querySelectorAll) NÃO vê elementos em Shadow DOM no LinkedIn
  let connDirect = false;
  try {
    // LinkedIn: aria-label = "Convidar [Nome] para se conectar" — não bate com /^Conectar$/i
    // Por isso testamos getByRole (accessible name) E filter hasText (texto visível)
    let connectBtn = page.getByRole('button', { name: /^Conectar$/i });
    let visible = await connectBtn.isVisible({ timeout: 1_500 }).catch(() => false);
    if (!visible) {
      // aria-label não bate — tenta pelo texto visível do botão
      connectBtn = page.locator('button').filter({ hasText: /^Conectar$/i }).first();
      visible = await connectBtn.isVisible({ timeout: 1_500 }).catch(() => false);
    }
    if (!visible) {
      // Última tentativa: aria-label parcial "convidar" (LinkedIn usa "Convidar X para se conectar")
      connectBtn = page.getByRole('button', { name: /convidar/i });
      visible = await connectBtn.isVisible({ timeout: 1_500 }).catch(() => false);
    }
    if (visible) {
      log.debug('linkedin.conn_note.connDirect_shadowDOM', { found: true });
      await connectBtn.click();
      connDirect = true;
    }
  } catch { /* ok — fallback abaixo */ }

  if (!connDirect) {
    connDirect = await profileActionBtn(/^conectar$/i, /^conectar$/i).catch(() => false);
  }
  log.debug('linkedin.conn_note.connDirect', { connDirect });
  if (connDirect) {
    await sleep(800);
    const handled = await waitAndHandle();
    if (handled) {
      log.info('linkedin.connection.sent_directly', { action: 'convite enviado' });
      return true;
    }
  }

  // Tenta dropdown "… Mais" → Conectar ("… mais" tem reticências no texto real)
  const maisOpened = await profileActionBtn(/mais$/i, /mais$/i).catch(() => false);
  log.debug('linkedin.conn_note.maisOpened', { maisOpened });
  if (maisOpened) {
    await sleep(1_000);

    if (await isInviteModalOpen(page)) {
      const ok = await handleInviteModal(page, message);
      if (ok) return true;
    }

    // Tenta clicar "Conectar" dentro do dropdown (sem guard — jsDropItem retorna false se não encontrar)
    const connInDrop = await (async () => {
      try {
        const item = page.locator('[role="menu"]').locator(':text-matches("^Conectar$", "i")').first();
        const visible = await item.isVisible({ timeout: 2_500 });
        log.debug('linkedin.dropdown.locator', { visible });
        if (visible) { await item.click(); return true; }
      } catch (e) { log.debug('linkedin.dropdown.locator_err', { err: String(e).slice(0, 80) }); }
      const jsDrop = await jsDropItem(/^conectar$/i).catch(() => false);
      log.debug('linkedin.dropdown.jsDropItem', { clicked: jsDrop });
      return jsDrop;
    })();

    if (connInDrop) {
      await sleep(800);
      const handled = await waitAndHandle();
      if (handled) {
        log.info('linkedin.connection.sent_from_dropdown', { action: 'convite enviado via dropdown' });
        return true;
      }
    } else {
      log.debug('linkedin.dropdown.no_connect', { action: 'closing dropdown' });
      try { await page.keyboard.press('Escape'); } catch { /* ok */ }
      await sleep(500);
    }
  }

  return false;
}

// ─── Dry-run ──────────────────────────────────────────────────────────────────

function runDryRun(targets: Lead[], rawTemplate: string): void {
  console.log('\n[DRY-RUN] Nenhuma DM será enviada. Browser não será aberto.\n');
  console.log(`[LINKEDIN DM] ${targets.length} leads encontrados\n`);
  for (let i = 0; i < targets.length; i++) {
    const lead    = targets[i];
    const message = buildMessage(rawTemplate, lead.name, lead.company);
    const fits    = message.length <= NOTE_CHAR_LIMIT;
    console.log(`[${i + 1}/${targets.length}] ${lead.name} — ${lead.company} (${lead.role})`);
    console.log(`  URL    : ${lead.linkedin_url}`);
    console.log(`  CHARS  : ${message.length} / ${NOTE_CHAR_LIMIT} ${fits ? '✓ cabe em nota' : '⚠️  excede'}`);
    console.log(`  DM     :\n${message.split('\n').map((l: string) => `    ${l}`).join('\n')}`);
    console.log('  ' + '─'.repeat(60));
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

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

  // ── State Machine — persistência cross-session por URL ────────────────────
  const sm = new LeadStateMachine(LEAD_STATE_FILE);
  sm.load();

  // Migração: seed SM a partir do log diário existente
  if (fs.existsSync(LOG_FILE)) {
    try {
      const existing: DmLog[] = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
      sm.seedFromDmLog(existing);
    } catch { /* log corrompido — ignora */ }
  }

  // Deduplica por URL e filtra via SM (cross-session)
  const seen = new Set<string>();
  const allTargets = leadsFile.contacts.filter(l => {
    const url = l.linkedin_url?.trim();
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return !sm.shouldSkip(url);
  });

  const skippedBySM = leadsFile.contacts.length - allTargets.length;
  if (skippedBySM > 0)
    console.log(`[SKIP] ${skippedBySM} leads já tratados (SM) — pulados\n`);

  const sliced  = OFFSET > 0 ? allTargets.slice(OFFSET) : allTargets;
  const targets = isFinite(LIMIT) ? sliced.slice(0, LIMIT) : sliced;

  if (targets.length === 0) { console.error('[ERRO] Nenhum lead pendente encontrado.'); process.exit(1); }
  if (LIMIT < Infinity || OFFSET > 0)
    console.log(`[LIMIT] offset ${OFFSET}, processando ${targets.length} de ${allTargets.length} leads\n`);
  if (DRY_RUN) { runDryRun(targets, rawTemplate); return; }

  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  try { execSync('taskkill /F /IM chrome.exe', { stdio: 'ignore' }); } catch { /* ok */ }
  await sleep(1_500);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: false,
    viewport: null,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  if (!isBusinessHours()) {
    console.error('[BLOQUEIO] Fora da janela comercial (seg-sex 08h-18h Brasília). Abortando.');
    await context.close();
    process.exit(0);
  }

  const dailyState = loadDailyState();
  if (dailyState.count >= DAILY_CAP) {
    console.error(`[BLOQUEIO] Cap diário atingido (${DAILY_CAP} ações). Retome amanhã.`);
    await context.close();
    process.exit(0);
  }
  const remaining = DAILY_CAP - dailyState.count;
  console.log(`[PROTEÇÃO] Cap diário: ${dailyState.count}/${DAILY_CAP} usados — ${remaining} disponíveis hoje`);

  const page  = await ensureLoggedIn(context);
  const capped = targets.slice(0, remaining);
  console.log(`[LINKEDIN DM] ${capped.length} leads nesta sessão (de ${targets.length} totais)\n`);

  const logs: DmLog[] = fs.existsSync(LOG_FILE) ? (() => {
    try { return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8')); } catch { return []; }
  })() : [];

  const sessionRunId = `linkedin-${Date.now()}`;
  let sent = 0, errors = 0, skipped = 0;

  log.info('linkedin.dispatch.start', {
    runId: sessionRunId,
    totalLeads: capped.length,
    capRemaining: remaining,
    smSummary: sm.summary(),
  });

  for (let i = 0; i < capped.length; i++) {
    if (!isBusinessHours()) {
      console.log('[PROTEÇÃO] Saiu da janela comercial. Pausando sessão.');
      break;
    }

    const lead    = capped[i];
    const message = buildMessage(rawTemplate, lead.name, lead.company);
    const url     = lead.linkedin_url;
    const leadStart = Date.now();

    console.log(`[${i + 1}/${capped.length}] ${lead.name} — ${lead.company} (${lead.role})`);

    try {
      const reached = await navigateToProfile(page, url);
      if (!reached) throw new Error('Perfil não encontrado');

      await humanScroll(page);

      try { await page.waitForLoadState('networkidle', { timeout: 5_000 }); } catch { /* ok */ }
      if (!/linkedin\.com\/in\//.test(page.url())) {
        await page.goto(url, { waitUntil: 'load', timeout: 40_000 });
        await sleep(2_000);
      }

      // ── Fase 1: Análise do perfil ANTES de qualquer ação ─────────────────
      const analysis = await analyzeProfile(page);
      console.log(`  [ANALYSIS] estado=${analysis.state} | msg=${analysis.hasMessageButton} | conn=${analysis.hasConnectButton} | pending=${analysis.hasPendingInvite}`);
      console.log(`  [BUTTONS]  ${JSON.stringify(analysis.visibleButtons.slice(0, 12))}`);

      sm.transition(url, 'PROFILE_ANALYZED', 'profile_analyzed', {
        name: lead.name, company: lead.company
      });

      // ── Fase 2: Estratégia baseada no estado real ─────────────────────────
      const decision = selectStrategy(analysis.state, sm.getState(url));
      console.log(`  [STRATEGY] ${decision.strategy} — ${decision.reason}`);

      log.info('linkedin.strategy.selected', {
        runId: sessionRunId,
        leadUrl: url,
        profileState: analysis.state,
        strategy: decision.strategy,
        reason: decision.reason,
      });

      // ── Fase 3: Execução focada ───────────────────────────────────────────
      if (decision.strategy === 'SKIP_NO_CHANNEL') {
        console.log('  ⚠ Sem canal — InMail Premium requerido, sem Conectar disponível');
        sm.transition(url, 'CLOSED', 'no_channel_available', { name: lead.name, company: lead.company });
        logs.push({ name: lead.name, company: lead.company, linkedin_url: url,
          method: 'unreachable', status: 'skipped',
          error: 'No channel: InMail Premium required', sent_at: new Date().toISOString() });
        skipped++;
        log.warn('linkedin.lead.no_channel', { runId: sessionRunId, leadUrl: url, durationMs: Date.now() - leadStart });
        fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), 'utf-8');
        sm.persist();
        await smartDelay(decision.strategy, false);
        continue;
      }

      if (decision.strategy === 'SKIP_PENDING_INVITE') {
        console.log('  ⏳ Convite pendente — aguardando aceite');
        sm.transition(url, 'INVITATION_SENT', 'pending_invite_detected', { name: lead.name, company: lead.company });
        skipped++;
        sm.persist();
        await smartDelay(decision.strategy, false);
        continue;
      }

      if (decision.strategy === 'SKIP_ALREADY_HANDLED') {
        console.log('  ✓ Já tratado anteriormente (SM)');
        sm.persist();
        continue;
      }

      // Executa a ação correta
      let success = false;
      let methodUsed: 'message' | 'connect_note';

      if (decision.strategy === 'SEND_DIRECT_MESSAGE') {
        try {
          success = await executeSendDirectMessage(page, message);
          methodUsed = 'message';
        } catch (dmErr) {
          const dmMsg = dmErr instanceof Error ? dmErr.message : String(dmErr);
          if (dmMsg === 'INMAIL_PREMIUM_REQUIRED') {
            // "Mensagem" requer InMail Premium — tenta fallback para convite com nota
            // (perfil detectado como 1º grau mas na prática exige Premium para InMail)
            console.log('  ↩ InMail bloqueado — re-navegando ao perfil para fallback SEND_CONNECTION_NOTE');
            log.info('linkedin.fallback.connection_note', {
              runId: sessionRunId, leadUrl: url, reason: 'inmail_required_on_direct_message',
            });
            // Re-navega ao perfil: estado DOM limpo após o modal Premium (LinkedIn mostra
            // botão "Conectar" no reload mas não no estado modal-dismissed)
            await navigateToProfile(page, url);
            try { await page.waitForLoadState('networkidle', { timeout: 6_000 }); } catch { /* ok */ }
            await sleep(1_500);
            success = await executeSendConnectionNote(page, message);
            methodUsed = 'connect_note';
            if (!success) {
              // getByRole (Shadow DOM) + page.evaluate ambos falharam após reload limpo
              // → perfil genuinamente InMail-only, sem canal de conexão gratuito
              log.info('linkedin.fallback.no_connect_confirmed', { url });
              throw new Error('INMAIL_PREMIUM_REQUIRED'); // tratado como NO_CHANNEL no outer catch
            }
          } else {
            throw dmErr;
          }
        }
      } else {
        // SEND_CONNECTION_NOTE
        success = await executeSendConnectionNote(page, message);
        methodUsed = 'connect_note';
      }

      if (!success) {
        // Tira screenshot para diagnóstico
        const dbg = path.join(ROOT, 'vault', 'imprensa', 'logs',
          `debug_${lead.name.replace(/\s+/g, '_')}.png`);
        await page.screenshot({ path: dbg, fullPage: false });
        throw new Error(`Ação falhou — strategy=${decision.strategy} (screenshot: ${path.basename(dbg)})`);
      }

      const now = new Date().toISOString();
      console.log(`  ✓ Enviada (${methodUsed})`);

      // Atualiza SM
      if (methodUsed === 'message') {
        sm.transition(url, 'MESSAGE_SENT', 'message_delivered', {
          name: lead.name, company: lead.company, messageSentAt: now
        });
      } else {
        sm.transition(url, 'INVITATION_SENT', 'connection_note_sent', {
          name: lead.name, company: lead.company, inviteSentAt: now
        });
      }

      logs.push({ name: lead.name, company: lead.company, linkedin_url: url,
        method: methodUsed, status: 'sent', sent_at: now });
      sent++;
      dailyState.count++;
      saveDailyState(dailyState);

      log.info('linkedin.lead.sent', {
        runId: sessionRunId,
        leadUrl: url,
        leadName: lead.name,
        company: lead.company,
        method: methodUsed,
        durationMs: Date.now() - leadStart,
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (msg === 'INMAIL_PREMIUM_REQUIRED') {
        // LinkedIn exige InMail Premium — trata como NO_CHANNEL, não como erro
        console.log('  ⚠ InMail Premium requerido — sem canal gratuito, perfil fechado');
        sm.transition(url, 'CLOSED', 'no_channel_inmail_required', {
          name: lead.name, company: lead.company,
          lastError: 'InMail Premium required',
        });
        logs.push({ name: lead.name, company: lead.company, linkedin_url: url,
          method: 'unreachable', status: 'skipped',
          error: 'InMail Premium required', sent_at: new Date().toISOString() });
        skipped++;
        log.warn('linkedin.lead.inmail_required', {
          runId: sessionRunId, leadUrl: url, durationMs: Date.now() - leadStart,
        });
      } else {
        console.log(`  ✗ Erro: ${msg}`);
        sm.transition(url, 'COLLECTED', 'execution_error', {
          name: lead.name, company: lead.company, lastError: msg
        });
        logs.push({ name: lead.name, company: lead.company, linkedin_url: url,
          method: 'error', status: 'error', error: msg, sent_at: new Date().toISOString() });
        errors++;
        log.error('linkedin.lead.error', {
          runId: sessionRunId, leadUrl: url, error: msg, durationMs: Date.now() - leadStart,
        });
      }
    }

    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), 'utf-8');
    sm.persist();

    if (i < capped.length - 1) {
      const lastDecision = logs[logs.length - 1];
      const wasAction = lastDecision?.status === 'sent';
      await smartDelay(
        wasAction ? 'SEND_DIRECT_MESSAGE' : 'SKIP_NO_CHANNEL',
        wasAction
      );
    }
  }

  await context.close();

  log.info('linkedin.dispatch.summary', {
    runId: sessionRunId,
    sent, errors, skipped,
    capUsed: dailyState.count,
    successRate: sent + errors > 0 ? (sent / (sent + errors)).toFixed(2) : 'n/a',
    smSummary: sm.summary(),
  });

  console.log('\n[RESUMO LINKEDIN DM]');
  console.log(`  Enviadas    : ${sent}`);
  console.log(`  Erros       : ${errors}`);
  console.log(`  Pulados     : ${skipped}`);
  console.log(`  Cap hoje    : ${dailyState.count}/${DAILY_CAP}`);
  console.log(`  SM States   : ${JSON.stringify(sm.summary())}`);
  console.log(`  Log         : ${LOG_FILE}\n`);
}

main().catch(err => { log.error('linkedin.dispatch.fatal', { error: String(err) }); process.exit(1); });
