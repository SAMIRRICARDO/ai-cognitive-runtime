// packages/work/src/tunnel/start-tunnel.ts
// Inicia túnel cloudflared na porta 3001 e grava a URL pública em .vraxia-work/tunnel-url.txt

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { sendTunnelNotification } from '../notifications/telegram.js';

// Carrega .env para obter TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID
function loadEnv(): void {
  const dirs = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
  ];
  for (const f of dirs) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

const WORK_STATE_DIR    = path.resolve(process.cwd(), '.vraxia-work');
const TUNNEL_URL_FILE   = path.join(WORK_STATE_DIR, 'tunnel-url.txt');
const LOCAL_CLOUDFLARED = path.join(WORK_STATE_DIR, 'cloudflared.exe');

function resolveCloudflared(): string {
  // 1. PATH
  try { execSync('cloudflared --version', { stdio: 'ignore' }); return 'cloudflared'; } catch {}
  // 2. local binary
  if (fs.existsSync(LOCAL_CLOUDFLARED)) {
    console.log(`[Tunnel] Usando cloudflared local: ${LOCAL_CLOUDFLARED}`);
    return LOCAL_CLOUDFLARED;
  }
  // 3. download
  console.log('[Tunnel] cloudflared não encontrado — baixando...');
  if (process.platform === 'win32') {
    try {
      execSync(
        `powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '${LOCAL_CLOUDFLARED}'"`,
        { stdio: 'inherit' }
      );
      if (fs.existsSync(LOCAL_CLOUDFLARED)) return LOCAL_CLOUDFLARED;
    } catch {}
  }
  console.error('[Tunnel] Falha ao obter cloudflared. Instale em: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/');
  process.exit(1);
}

async function startTunnel(restartCount = 0): Promise<void> {
  loadEnv();
  const bin = resolveCloudflared();
  fs.mkdirSync(path.dirname(TUNNEL_URL_FILE), { recursive: true });

  console.log('[Tunnel] Iniciando cloudflared na porta 3001...');
  console.log('[Tunnel] Aguardando URL pública...\n');

  const proc = spawn(bin, ['tunnel', '--url', 'http://localhost:3001', '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let urlFound = false;

  const handleOutput = (data: Buffer): void => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !urlFound) {
        urlFound = true;
        const url = match[0];
        fs.writeFileSync(TUNNEL_URL_FILE, url);
        console.log(`\n[Tunnel] ✅ URL pública: ${url}`);
        console.log(`[Tunnel] Configure no dashboard: ${url}`);
        console.log(`[Tunnel] Dashboard Vercel: https://vraxia-platform.vercel.app\n`);
        console.log(`[Tunnel] No dashboard, clique em ⚙ e configure a API URL como:\n  ${url}\n`);
        sendTunnelNotification(url).catch(() => {}); // cooldown gerenciado internamente
      }
      if (line.trim()) process.stdout.write('[Tunnel] ' + line + '\n');
    }
  };

  proc.stdout.on('data', handleOutput);
  proc.stderr.on('data', handleOutput);

  let shutdownRequested = false;

  proc.on('exit', (code) => {
    if (shutdownRequested) {
      process.exit(0);
      return;
    }
    const attempt = (restartCount ?? 0) + 1;
    const maxRetries = 5;
    if (attempt > maxRetries) {
      console.error(`[Tunnel] ${maxRetries} tentativas falharam — encerrando. Reinicie manualmente.`);
      process.exit(1);
      return;
    }
    // Exponential backoff: 5s, 10s, 20s, 40s, 80s
    const delay = Math.min(5000 * Math.pow(2, attempt - 1), 120_000);
    console.log(`\n[Tunnel] cloudflared encerrou (code ${code ?? 'null'}) — tentativa ${attempt}/${maxRetries}, aguardando ${delay / 1000}s...`);
    try { fs.writeFileSync(TUNNEL_URL_FILE, ''); } catch {}
    setTimeout(() => {
      startTunnel(attempt).catch(err => {
        console.error('[Tunnel] Falha ao reiniciar:', err);
        process.exit(1);
      });
    }, delay);
  });

  process.on('SIGINT', () => {
    shutdownRequested = true;
    proc.kill('SIGTERM');
    process.exit(0);
  });
}

startTunnel().catch(err => {
  console.error('[Tunnel] Erro fatal:', err);
  process.exit(1);
});
