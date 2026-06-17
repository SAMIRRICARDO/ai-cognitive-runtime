/// <reference lib="dom" />
import { type Page } from 'playwright';

export type ProfileContactState =
  | 'DIRECT_MESSAGE_AVAILABLE'  // 1º grau — botão Mensagem presente
  | 'CONNECTION_REQUIRED'        // 2º/3º grau — botão Conectar presente
  | 'INVITATION_SENT'           // convite pendente no perfil
  | 'NO_CHANNEL';               // sem canal disponível (InMail obrigatório)

export interface ProfileAnalysis {
  state: ProfileContactState;
  hasMessageButton: boolean;
  hasConnectButton: boolean;
  hasPendingInvite: boolean;
  visibleButtons: string[];
}

const CHAT_CONTAINERS = [
  '.msg-overlay-conversation-bubble',
  '.msg-overlay-list-bubble',
  '#msg-overlay',
  '[data-view-name="messaging-overlay"]',
];

export async function closeFloatingChats(page: Page): Promise<void> {
  await page.evaluate((sels: string[]) => {
    for (const sel of sels) {
      document.querySelectorAll<HTMLElement>(sel).forEach(function(container) {
        const closeSel = '.msg-overlay-conversation-bubble__close-btn, button[data-test-messaging-close-overlay], button[data-control-name="overlay.minimize_connection_list_bar"]';
        container.querySelectorAll<HTMLElement>(closeSel).forEach(function(btn) { btn.click(); });
      });
    }
  }, CHAT_CONTAINERS);
  await new Promise<void>(r => setTimeout(r, 500));
}

// Lê o estado DOM do perfil ANTES de qualquer ação
// Resolve o problema central: dispatcher reagia sem saber o estado do relacionamento
export async function analyzeProfile(page: Page): Promise<ProfileAnalysis> {
  await closeFloatingChats(page);
  // Aguarda botões de ação do perfil estarem no DOM antes de analisar
  await page.waitForSelector(
    'button[aria-label*="Convidar"], button[aria-label*="mensagem"], button[aria-label*="message"], ' +
    'button[aria-label*="Pendente"], button[aria-label*="pending"]',
    { timeout: 6_000 }
  ).catch(function() { /* ok — cai no sleep abaixo */ });
  await new Promise<void>(r => setTimeout(r, 1_200));

  return page.evaluate((chatSels: string[]): ProfileAnalysis => {
    const allButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    const win = window.innerWidth;

    // Exclui botões em containers de chat flutuante e na sidebar direita
    const profileButtons = allButtons.filter(function(btn) {
      const rect = btn.getBoundingClientRect();
      if (rect.width === 0) return false;
      if (rect.left >= win * 0.75) return false;
      return !chatSels.some(function(s) { return btn.closest(s) !== null; });
    });

    const texts = profileButtons.map(function(b) {
      return (b.innerText ?? '').trim().split('\n')[0].trim().toLowerCase();
    });
    // fullTexts: texto completo sem split — captura botões multiline como "Pendente ▼"
    const fullTexts = profileButtons.map(function(b) {
      return (b.innerText ?? '').trim().toLowerCase();
    });
    const arias = profileButtons.map(function(b) {
      return (b.getAttribute('aria-label') ?? '').toLowerCase();
    });
    const all = [...texts, ...fullTexts, ...arias];

    // hasPendingInvite: SEM filtro de posição — "Pendente ▼" fica à direita de "Enviar mensagem"
    // e pode ultrapassar o threshold 0.75 em viewports menores
    // Exclui apenas containers de chat flutuante
    const pendingTerms = ['pendente', 'pending', 'aguardando resposta', 'convite enviado', 'retirar convite'];
    const hasPendingInvite = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).some(function(b) {
      if (b.getBoundingClientRect().width === 0) return false;
      if (chatSels.some(function(s) { return b.closest(s) !== null; })) return false;
      const t = (b.innerText ?? '').trim().toLowerCase();
      return pendingTerms.some(function(term) { return t.includes(term); });
    });
    const hasConnectButton =
      all.some(function(v) { return v.includes('conectar'); }) ||
      arias.some(function(a) { return a.includes('convidar'); });
    const hasMessageButton =
      texts.some(function(t) { return t === 'mensagem' || t === 'enviar mensagem'; }) ||
      arias.some(function(a) { return a.includes('mensagem') || a.includes('message'); });

    let state: ProfileContactState;
    if (hasPendingInvite) {
      state = 'INVITATION_SENT';
    } else if (hasMessageButton && !hasConnectButton) {
      state = 'DIRECT_MESSAGE_AVAILABLE';
    } else if (hasConnectButton) {
      state = 'CONNECTION_REQUIRED';
    } else {
      state = 'NO_CHANNEL';
    }

    return {
      state,
      hasMessageButton,
      hasConnectButton,
      hasPendingInvite,
      visibleButtons: [...new Set(all)].filter(Boolean).slice(0, 20),
    };
  }, CHAT_CONTAINERS);
}
