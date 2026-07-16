// packages/work/src/deploy/dashboard.ts
// Exporta snapshot de dados e faz deploy do dashboard no Vercel.
// Chamado ao final de toda sessão de candidatura (hunt, apply-filtered, etc.)

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const WORK_DIR  = path.resolve(process.cwd(), '.vraxia-work');
const DASH_DIR  = path.resolve(process.cwd(), 'dashboard');
const JSONL_SRC = path.join(WORK_DIR, 'questionnaire-log.jsonl');
const SNAP_DEST = path.join(DASH_DIR, 'questionnaire-data.json');
const TUNNEL_URL_FILE = path.join(WORK_DIR, 'tunnel-url.txt');
const API_CONFIG_FILE = path.join(DASH_DIR, 'api-config.json');

type Entry = Record<string, unknown>;

function exportQuestionnaireSnapshot(): void {
  if (!fs.existsSync(JSONL_SRC)) return;

  const entries = fs.readFileSync(JSONL_SRC, 'utf-8')
    .split('\n').filter(l => l.trim())
    .map(l => { try { return JSON.parse(l) as Entry; } catch { return null; } })
    .filter(Boolean) as Entry[];

  const grouped: Record<string, { job_id: string; job_title: string; company: string; job_url: string; entries: Entry[] }> = {};
  for (const e of entries) {
    const key = (e['job_id'] as string) || 'unknown';
    if (!grouped[key]) {
      grouped[key] = {
        job_id:    e['job_id'] as string,
        job_title: e['job_title'] as string,
        company:   e['company'] as string,
        job_url:   (e['job_url'] as string) ?? '',
        entries:   [],
      };
    }
    grouped[key].entries.push(e);
  }

  fs.writeFileSync(SNAP_DEST, JSON.stringify(Object.values(grouped)), 'utf-8');
  console.log('[Deploy] questionnaire-data.json exportado.');
}

function updateApiConfig(): void {
  if (!fs.existsSync(TUNNEL_URL_FILE)) return;
  const tunnelUrl = fs.readFileSync(TUNNEL_URL_FILE, 'utf-8').trim();
  if (!tunnelUrl.startsWith('https://')) return;

  fs.writeFileSync(
    API_CONFIG_FILE,
    JSON.stringify({ apiUrl: tunnelUrl, updatedAt: new Date().toISOString() }),
    'utf-8',
  );
  console.log(`[Deploy] api-config.json → ${tunnelUrl}`);
}

export async function deployDashboard(): Promise<void> {
  try {
    exportQuestionnaireSnapshot();
    updateApiConfig();

    console.log('[Deploy] Publicando dashboard no Vercel...');
    const out = execSync('vercel --prod --yes 2>&1', { cwd: DASH_DIR, timeout: 120_000 }).toString().trim();
    const urlMatch = out.match(/https:\/\/\S+\.vercel\.app/);
    console.log(`[Deploy] ✅ Dashboard atualizado${urlMatch ? ': ' + urlMatch[0] : ' no Vercel'}`);
  } catch (err) {
    console.warn('[Deploy] Falha no deploy automático:', String(err).slice(0, 120));
  }
}
