// packages/work/src/deploy/dashboard.ts
// Exporta snapshot de dados e faz deploy do dashboard no Vercel.
// Chamado ao final de toda sessão de candidatura (hunt, apply-filtered, etc.)

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// daily-runner.ts é chamado pelo Task Scheduler com CWD arbitrário.
// tsx injeta __dirname no escopo do módulo → packages/work/src/deploy/ → ../.. = packages/work/
const PKG_DIR = path.resolve(__dirname, '../..');

const WORK_DIR  = path.join(PKG_DIR, '.vraxia-work');
const DASH_DIR  = path.join(PKG_DIR, 'dashboard');
const JSONL_SRC = path.join(WORK_DIR, 'questionnaire-log.jsonl');
const SNAP_DEST = path.join(DASH_DIR, 'questionnaire-data.json');
const TUNNEL_URL_FILE = path.join(WORK_DIR, 'tunnel-url.txt');
const API_CONFIG_FILE = path.join(DASH_DIR, 'api-config.json');
const INDEX_HTML_FILE = path.join(DASH_DIR, 'index.html');

function resolveVercelBin(): string {
  try { execSync('vercel --version', { stdio: 'ignore' }); return 'vercel'; } catch {}
  const appData = process.env['APPDATA'] ?? '';
  const candidates = [
    path.join(appData, 'npm', 'vercel.cmd'),
    path.join(appData, 'npm', 'vercel'),
    path.join(appData, 'Roaming', 'npm', 'vercel.cmd'),
    'C:\\Program Files\\nodejs\\vercel.cmd',
  ];
  return candidates.find(p => fs.existsSync(p)) ?? '';
}

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
  // Lê tunnel-url.txt (escrito pelo processo do tunnel quando a URL está ativa)
  let tunnelUrl = '';
  if (fs.existsSync(TUNNEL_URL_FILE)) {
    tunnelUrl = fs.readFileSync(TUNNEL_URL_FILE, 'utf-8').trim();
  }

  // Fallback: se o arquivo foi zerado (startup do tunnel), preserva a URL atual do api-config.json
  if (!tunnelUrl.startsWith('https://')) {
    try {
      const existing = JSON.parse(fs.readFileSync(API_CONFIG_FILE, 'utf-8')) as { apiUrl?: string };
      tunnelUrl = existing.apiUrl ?? '';
      if (tunnelUrl) console.log(`[Deploy] tunnel-url.txt vazio — usando URL existente do api-config.json: ${tunnelUrl}`);
    } catch {}
  }

  if (!tunnelUrl.startsWith('https://')) {
    console.warn('[Deploy] Nenhuma URL de tunnel disponível — api-config.json não atualizado.');
    return;
  }

  // Preserva o campo provider se já existir no api-config.json
  let provider = 'cloudflare';
  try {
    const existing = JSON.parse(fs.readFileSync(API_CONFIG_FILE, 'utf-8')) as { provider?: string };
    if (existing.provider) provider = existing.provider;
  } catch {}

  fs.writeFileSync(
    API_CONFIG_FILE,
    JSON.stringify({ apiUrl: tunnelUrl, provider, updatedAt: new Date().toISOString() }),
    'utf-8',
  );
  console.log(`[Deploy] api-config.json → ${tunnelUrl}`);

  // Atualiza window.VRAXIA_API_URL no index.html para que o iPhone use a URL
  // correta mesmo quando o Vercel tem SSO e não pode servir api-config.json.
  if (fs.existsSync(INDEX_HTML_FILE)) {
    let html = fs.readFileSync(INDEX_HTML_FILE, 'utf-8');
    html = html.replace(
      /window\.VRAXIA_API_URL\s*=\s*["'][^"']*["'];/,
      `window.VRAXIA_API_URL = "${tunnelUrl}";`,
    );
    fs.writeFileSync(INDEX_HTML_FILE, html, 'utf-8');
    console.log(`[Deploy] index.html window.VRAXIA_API_URL → ${tunnelUrl}`);
  }
}

export async function deployDashboard(): Promise<void> {
  try {
    exportQuestionnaireSnapshot();
    updateApiConfig();

    const vercelBin = resolveVercelBin();
    if (!vercelBin) {
      console.warn('[Deploy] vercel CLI não encontrado — deploy ignorado. Instale: npm i -g vercel');
      return;
    }

    console.log(`[Deploy] Publicando dashboard no Vercel via "${vercelBin}"...`);
    const out = execSync(`"${vercelBin}" --prod --yes 2>&1`, { cwd: DASH_DIR, timeout: 180_000 }).toString().trim();
    const urlMatch = out.match(/https:\/\/\S+\.vercel\.app/);
    console.log(`[Deploy] ✅ Dashboard atualizado${urlMatch ? ': ' + urlMatch[0] : ' no Vercel'}`);
  } catch (err) {
    console.warn('[Deploy] Falha no deploy automático:', String(err).slice(0, 300));
  }
}
