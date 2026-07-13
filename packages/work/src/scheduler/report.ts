// packages/work/src/scheduler/report.ts
// Envia relatório diário ao Telegram — disparado pelo Task Scheduler às 12h.

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { sendDailyReport } from '../notifications/telegram.js';

// Carrega .env da raiz do monorepo (Task Scheduler não herda vars do shell)
const PKG_DIR   = path.resolve(__dirname, '../../');
const MONO_ROOT = path.resolve(PKG_DIR, '../../');
dotenv.config({ path: path.join(MONO_ROOT, '.env'), override: false });

const HISTORY_PATH = path.join(PKG_DIR, '.vraxia-work', 'scheduler-history.jsonl');

function lastRunInfo(): { exitCode: number | null; durationMs: number; platform: string } {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const lines = fs.existsSync(HISTORY_PATH)
      ? fs.readFileSync(HISTORY_PATH, 'utf-8').split('\n').filter(l => l.trim())
      : [];
    const todayEntries = lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(e => e && e.date === today && !e.dryRun);
    if (todayEntries.length > 0) {
      const last = todayEntries[todayEntries.length - 1];
      return { exitCode: last.exitCode, durationMs: last.durationMs, platform: last.platform };
    }
  } catch { /* ignore */ }
  return { exitCode: null, durationMs: 0, platform: 'all' };
}

async function main(): Promise<void> {
  const now  = new Date();
  const info = lastRunInfo();

  console.log(`[Report] Enviando relatório diário ao Telegram — ${now.toLocaleString('pt-BR')}`);

  await sendDailyReport({
    date:       now.toISOString().slice(0, 10),
    window:     'Relatório 12h',
    firedAt:    now.toISOString(),
    exitCode:   info.exitCode,
    durationMs: info.durationMs,
    platform:   info.platform,
    dryRun:     false,
  });

  console.log('[Report] ✅ Relatório enviado.');
}

main().catch(err => {
  console.error('[Report] Erro ao enviar relatório:', err);
  process.exit(1);
});
