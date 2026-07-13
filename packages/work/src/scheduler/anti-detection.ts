// packages/work/src/scheduler/anti-detection.ts
// Helpers de comportamento humano — usados pelo session.ts e daily-runner.

export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
];

export function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function humanDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(r => setTimeout(r, ms));
}

// Retorna true se a duração já ultrapassou o limite de sessão
export function sessionExpired(startedAt: Date, maxDurationMs: number): boolean {
  return Date.now() - startedAt.getTime() > maxDurationMs;
}

// Detecta padrões de ban/CAPTCHA numa URL ou texto de página
export function detectBanSignal(url: string, pageTitle = ''): 'ban' | 'captcha' | 'none' {
  const u = url.toLowerCase();
  const t = pageTitle.toLowerCase();
  if (u.includes('checkpoint') || u.includes('captcha') || t.includes('verification'))
    return 'captcha';
  if (u.includes('authwall') || u.includes('not-found') || t.includes('page not found'))
    return 'ban';
  return 'none';
}

// Jitter gaussiano aproximado — evita padrão linear
export function jitterMs(base: number, stdFraction = 0.15): number {
  const std = base * stdFraction;
  // Box-Muller
  const u1 = Math.random(), u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(1000, Math.round(base + z * std));
}
