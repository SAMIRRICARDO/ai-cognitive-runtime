// packages/work/src/scheduler/daily-runner.ts
// Agendador diário — sorteia janela humana, espera o horário, dispara hunt.ts.
// Executado pelo Windows Task Scheduler (VRAXIA-WORK-Daily) todos os dias úteis.

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { DEFAULT_CONFIG, pickRandomWindow, randomMinuteInWindow, SchedulerConfig } from './config.js';
import { sendDailyReport } from '../notifications/telegram.js';

// Diretório raiz do pacote packages/work/ — independente do CWD do Task Scheduler
// __dirname = packages/work/src/scheduler → ../../ = packages/work/
const PKG_DIR  = path.resolve(__dirname, '../../');

// Carrega .env da raiz do monorepo (Task Scheduler não herda variáveis do shell)
dotenv.config({ path: path.resolve(PKG_DIR, '../../.env'), override: false });

const WORK_DIR      = path.join(PKG_DIR, '.vraxia-work');
const COOLDOWN_PATH = path.join(WORK_DIR, 'cooldown.json');
const HISTORY_PATH  = path.join(WORK_DIR, 'scheduler-history.jsonl');

// ─── Cooldown ─────────────────────────────────────────────────────────────────

interface CooldownRecord { until: string; reason: string; }

function isCooldownActive(): boolean {
  try {
    if (!fs.existsSync(COOLDOWN_PATH)) return false;
    const r: CooldownRecord = JSON.parse(fs.readFileSync(COOLDOWN_PATH, 'utf-8'));
    return new Date(r.until) > new Date();
  } catch { return false; }
}

function setCooldown(reason: string, durationMs: number): void {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const until = new Date(Date.now() + durationMs).toISOString();
  fs.writeFileSync(COOLDOWN_PATH, JSON.stringify({ until, reason }, null, 2));
  console.log(`[Scheduler] Cooldown ativo até ${until} — ${reason}`);
}

// ─── History ──────────────────────────────────────────────────────────────────

interface HistoryEntry {
  date: string;
  window: string;
  firedAt: string;
  exitCode: number | null;
  durationMs: number;
  platform: string;
  dryRun: boolean;
}

function appendHistory(entry: HistoryEntry): void {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  fs.appendFileSync(HISTORY_PATH, JSON.stringify(entry) + '\n');
}

// Guard: impede segunda execução no mesmo dia (Task Scheduler dispara a cada 4h)
function ranToday(): boolean {
  try {
    if (!fs.existsSync(HISTORY_PATH)) return false;
    const today = new Date().toISOString().slice(0, 10);
    return fs.readFileSync(HISTORY_PATH, 'utf-8')
      .split('\n')
      .filter(l => l.trim())
      .some(l => { try { const e = JSON.parse(l); return e.date === today && !e.dryRun && e.exitCode === 0; } catch { return false; } });
  } catch { return false; }
}

// ─── Hunt runner ─────────────────────────────────────────────────────────────

function runHunt(cfg: SchedulerConfig): Promise<{ exitCode: number | null; duration: number }> {
  return new Promise(resolve => {
    const start = Date.now();
    const args = [
      path.join(PKG_DIR, 'src/cli/hunt.ts'),
      '--platform', cfg.platform,
      '--limit', String(cfg.maxDailyApplications),
    ];
    if (cfg.dryRun) args.push('--dry-run');

    const child = spawn('npx', ['tsx', ...args], {
      cwd:   PKG_DIR,  // packages/work/ — onde estão package.json e node_modules
      stdio: 'inherit',
      env:   process.env,
      shell: true,
    });

    const timeout = setTimeout(() => {
      child.kill();
      console.warn('[Scheduler] Sessão excedeu tempo máximo — encerrando.');
    }, cfg.maxSessionDurationMs);

    child.on('close', code => {
      clearTimeout(timeout);
      resolve({ exitCode: code, duration: Date.now() - start });
    });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cfg: SchedulerConfig = { ...DEFAULT_CONFIG };
  const now = new Date();
  const today = now.getDay(); // 0=Dom, 1=Seg...

  console.log(`\n[VRAXIA WORK Scheduler] ${now.toLocaleString('pt-BR')}`);

  // Verificar dia ativo
  if (!cfg.activeDays.includes(today)) {
    console.log(`[Scheduler] Hoje é ${['Dom','Seg','Ter','Qua','Qui','Sex','Sab'][today]} — dia inativo. Encerrando.`);
    return;
  }

  // Verificar cooldown
  if (isCooldownActive()) {
    console.log('[Scheduler] Cooldown ativo. Encerrando.');
    return;
  }

  // Guard de unicidade diária (Task Scheduler dispara a cada 4h — apenas 1 execução/dia)
  if (ranToday()) {
    console.log('[Scheduler] Quota diária já utilizada — encerrando até amanhã.');
    return;
  }

  // Janela de execução
  let windowName: string;
  let fireAt: Date;

  if (cfg.immediateMode) {
    windowName = 'Imediato';
    fireAt     = now;
    console.log('[Scheduler] Modo imediato — disparando agora');
  } else {
    const win = pickRandomWindow(cfg.executionWindows);
    fireAt    = randomMinuteInWindow(win);
    windowName = win.name;
    const waitMs = fireAt.getTime() - Date.now();
    if (waitMs > 0) {
      console.log(`[Scheduler] Janela "${win.name}" → ${fireAt.toLocaleTimeString('pt-BR')} (${Math.round(waitMs / 60000)}min)`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  // Executar hunt
  console.log(`[Scheduler] Iniciando Hunt Mode — plataforma: ${cfg.platform}, limite: ${cfg.maxDailyApplications}`);
  const { exitCode, duration } = await runHunt(cfg);

  // Registrar histórico
  appendHistory({
    date:       now.toISOString().slice(0, 10),
    window:     windowName,
    firedAt:    fireAt.toISOString(),
    exitCode,
    durationMs: duration,
    platform:   cfg.platform,
    dryRun:     cfg.dryRun,
  });

  // Cooldown em caso de sinal de ban (exit code 2 = ban detectado)
  if (exitCode === 2) {
    setCooldown('Ban detectado — exit code 2', cfg.cooldownAfterBanMs);
  }

  console.log(`[Scheduler] Sessão concluída em ${Math.round(duration / 1000)}s (exit: ${exitCode})`);

  // Relatório Telegram
  try {
    await sendDailyReport({
      date:       now.toISOString().slice(0, 10),
      window:     windowName,
      firedAt:    fireAt.toISOString(),
      exitCode,
      durationMs: duration,
      platform:   cfg.platform,
      dryRun:     cfg.dryRun,
    });
    console.log('[Scheduler] Relatório enviado ao Telegram.');
  } catch (err) {
    console.warn('[Scheduler] Falha ao enviar Telegram (não crítico):', String(err));
  }
}

main().catch(err => {
  console.error('[Scheduler] Erro fatal:', err);
  process.exit(1);
});
