// packages/work/src/scheduler/config.ts
// Configuração do agendador diário — limites anti-ban não negociáveis.

export interface ExecutionWindow {
  name: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

export interface SchedulerConfig {
  maxDailyApplications: number;
  minDelayBetweenApplyMs: number;
  maxDelayBetweenApplyMs: number;
  maxSessionDurationMs: number;
  activeDays: number[];            // 0=Dom, 1=Seg ... 6=Sab
  restDay: number;                 // sempre descanso (0=Dom)
  executionWindows: ExecutionWindow[];
  immediateMode: boolean;          // true = dispara imediatamente, sem esperar janela
  cooldownAfterBanMs: number;
  stopOnCaptcha: boolean;
  platform: 'linkedin' | 'gupy' | 'all';
  dryRun: boolean;
}

export const DEFAULT_CONFIG: SchedulerConfig = {
  // ── Limites anti-ban ──────────────────────────────────────────────────────
  maxDailyApplications:   8,                  // LinkedIn tolera ~10-15; ficamos abaixo do radar
  minDelayBetweenApplyMs: 45_000,             // 45s mínimo
  maxDelayBetweenApplyMs: 120_000,            // 2min máximo
  maxSessionDurationMs:   45 * 60 * 1000,     // 45 minutos por sessão
  activeDays:             [1, 2, 3, 4, 5],    // Seg-Sex
  restDay:                0,                  // Domingo: sempre descanso
  cooldownAfterBanMs:     24 * 60 * 60 * 1000, // 24h pós-ban
  stopOnCaptcha:          true,               // nunca tenta burlar

  // ── Janelas humanas (usadas apenas quando immediateMode = false) ──────────
  executionWindows: [
    { name: 'Manhã',     startHour: 8,  startMinute: 15, endHour: 8,  endMinute: 45 },
    { name: 'Almoço',    startHour: 12, startMinute: 30, endHour: 12, endMinute: 59 },
    { name: 'Fim do dia',startHour: 19, startMinute: 0,  endHour: 19, endMinute: 45 },
  ],

  immediateMode: true,   // dispara assim que o Task Scheduler acionar — sem espera de janela
  platform: 'all',
  dryRun:   false,
};

export function pickRandomWindow(windows: ExecutionWindow[]): ExecutionWindow {
  return windows[Math.floor(Math.random() * windows.length)];
}

export function randomMinuteInWindow(window: ExecutionWindow): Date {
  const now   = new Date();
  const start = new Date(now);
  start.setHours(window.startHour, window.startMinute, 0, 0);
  const end = new Date(now);
  end.setHours(window.endHour, window.endMinute, 0, 0);
  const range = end.getTime() - start.getTime();
  const offset = Math.floor(Math.random() * range);
  return new Date(start.getTime() + offset);
}
