// packages/work/src/notifications/telegram.ts
// Notificações Telegram via Bot API — sem dependência externa, usa fetch nativo (Node 18+).

import fs from 'fs';
import path from 'path';
import initSqlJs from 'sql.js';

const WORK_DIR = path.resolve(process.cwd(), '.vraxia-work');
const DB_PATH  = path.join(WORK_DIR, 'work.db');

// ─── Bot API ──────────────────────────────────────────────────────────────────

function credentials(): { token: string; chatId: string } {
  const token  = process.env['TELEGRAM_BOT_TOKEN']  ?? '';
  const chatId = process.env['TELEGRAM_CHAT_ID']    ?? '';
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não configurados no .env');
  return { token, chatId };
}

export async function sendMessage(html: string): Promise<void> {
  const { token, chatId } = credentials();
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const body = JSON.stringify({
    chat_id:    chatId,
    text:       html,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Telegram API error ${res.status}: ${detail}`);
  }
}

// ─── Leitura do DB ────────────────────────────────────────────────────────────

interface DayStats {
  applied: number;
  review: number;
  filtered: number;
  errors: number;
  topCompanies: Array<{ company: string; score: number }>;
  estimatedCostUsd: number;
}

async function readTodayStats(): Promise<DayStats> {
  const empty: DayStats = { applied: 0, review: 0, filtered: 0, errors: 0, topCompanies: [], estimatedCostUsd: 0 };
  if (!fs.existsSync(DB_PATH)) return empty;

  try {
    const SQL = await initSqlJs();
    const buf = fs.readFileSync(DB_PATH);
    const db  = new SQL.Database(buf);

    const exec = (sql: string) => {
      const r = db.exec(sql);
      if (!r.length) return [];
      const cols = r[0].columns;
      return r[0].values.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
    };

    const today = new Date().toISOString().slice(0, 10);

    const statusRows = exec(
      `SELECT status, COUNT(*) as cnt FROM job_applications
       WHERE DATE(updated_at) = '${today}' GROUP BY status`
    );

    const byStatus: Record<string, number> = {};
    for (const r of statusRows) byStatus[r['status'] as string] = r['cnt'] as number;

    const topRows = exec(
      `SELECT company, MAX(score_total) as score FROM job_applications
       WHERE DATE(updated_at) = '${today}' AND score_total > 0
       ORDER BY score_total DESC LIMIT 5`
    );

    // Custo estimado: chamadas Haiku não-FAST
    const qlogPath = path.join(WORK_DIR, 'questionnaire-log.jsonl');
    let llmCalls = 0;
    if (fs.existsSync(qlogPath)) {
      const fastTypes = new Set(['FAST_YESNO', 'FAST_NUMERIC', 'FAST_SALARY']);
      const entries = fs.readFileSync(qlogPath, 'utf-8').split('\n').filter(l => l.trim());
      for (const line of entries) {
        try {
          const e = JSON.parse(line);
          const ts: string = e['timestamp'] ?? '';
          if (ts.startsWith(today) && !fastTypes.has(e['tipo_detectado'] as string)) llmCalls++;
        } catch { /* ignore */ }
      }
    }
    const scoringCalls = (byStatus['applied'] ?? 0) + (byStatus['review'] ?? 0) + (byStatus['filtered_out'] ?? 0);
    const totalTokens  = (scoringCalls * 4_000) + (llmCalls * 650);
    const estimatedCostUsd = totalTokens * 0.80 / 1_000_000;

    db.close();

    return {
      applied:  byStatus['applied']      ?? 0,
      review:   byStatus['review']       ?? 0,
      filtered: (byStatus['filtered_out'] ?? 0) + (byStatus['scanned'] ?? 0),
      errors:   byStatus['error']        ?? 0,
      topCompanies: topRows.map(r => ({ company: r['company'] as string, score: r['score'] as number })),
      estimatedCostUsd,
    };
  } catch {
    return empty;
  }
}

// ─── Relatório diário ─────────────────────────────────────────────────────────

export interface ReportEntry {
  date:       string;
  window:     string;
  firedAt:    string;
  exitCode:   number | null;
  durationMs: number;
  platform:   string;
  dryRun:     boolean;
}

function nextRunLabel(): string {
  const now   = new Date();
  const slots = [0, 4, 8, 12, 16, 20];
  const h     = now.getHours();
  const next  = slots.find(s => s > h) ?? 0;
  const d     = next === 0 ? new Date(now.getTime() + 86_400_000) : now;
  d.setHours(next, 1, 0, 0);
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export async function sendDailyReport(entry: ReportEntry): Promise<void> {
  const stats   = await readTodayStats();
  const dur     = Math.round(entry.durationMs / 1000);
  const durStr  = dur >= 60 ? `${Math.floor(dur / 60)}m ${dur % 60}s` : `${dur}s`;
  const date    = new Date(entry.firedAt).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  const exitOk  = entry.exitCode === 0 || entry.exitCode === null;

  const topBlock = stats.topCompanies.length
    ? '\n' + stats.topCompanies.map(c => `  • ${c.company}  <b>${c.score}/30</b>`).join('\n')
    : '  (nenhuma pontuada hoje)';

  const statusIcon = entry.dryRun ? '🧪' : exitOk ? '✅' : '⚠️';
  const modeLabel  = entry.dryRun ? ' <i>[DRY RUN]</i>' : '';

  const msg = `${statusIcon} <b>VRAXIA WORK — ${date}</b>${modeLabel}

⏱ Duração: ${durStr}   📡 Plataforma: ${entry.platform.toUpperCase()}

✅ Aplicadas:  <b>${stats.applied}</b>
⚠️ Revisão:    <b>${stats.review}</b>
⏭ Filtradas:  <b>${stats.filtered}</b>
❌ Erros:      <b>${stats.errors}</b>

💰 Custo est.: <b>$${stats.estimatedCostUsd.toFixed(4)}</b>

🏆 Top vagas:${topBlock}

📅 Próxima: ${nextRunLabel()}`;

  await sendMessage(msg);
}

// ─── Teste rápido: npx tsx src/notifications/telegram.ts ─────────────────────
if (process.argv[1]?.endsWith('telegram.ts') || process.argv[1]?.endsWith('telegram.js')) {
  // Sobe até 4 dirs para encontrar o .env (pode estar na raiz do monorepo)
  let envDir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const p = path.join(envDir, '.env');
    if (fs.existsSync(p)) {
      for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
        if (m) process.env[m[1]] ??= m[2].trim();
      }
      break;
    }
    envDir = path.dirname(envDir);
  }

  sendDailyReport({
    date: new Date().toISOString().slice(0, 10),
    window: 'Teste',
    firedAt: new Date().toISOString(),
    exitCode: 0,
    durationMs: 743_000,
    platform: 'all',
    dryRun: false,
  }).then(() => console.log('✅ Mensagem enviada!')).catch(console.error);
}
