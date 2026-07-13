// packages/work/src/tunnel/start-tunnel.ts
// Inicia túnel cloudflared na porta 3001 e grava a URL pública em .vraxia-work/tunnel-url.txt

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';

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

function sendTelegram(tunnelUrl: string): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat  = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;

  const text = `🔗 VRAXIA — Novo túnel ativo\n\n` +
    `URL: ${tunnelUrl}\n\n` +
    `Cole no dashboard ⚙:\nhttps://vraxia-platform.vercel.app`;

  const body = JSON.stringify({ chat_id: chat, text });
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  });
  req.on('error', () => {}); // não crítico
  req.write(body);
  req.end();
}

const WORK_STATE_DIR    = path.resolve(process.cwd(), '.vraxia-work');
const TUNNEL_URL_FILE   = path.join(WORK_STATE_DIR, 'tunnel-url.txt');
const TUNNEL_NOTIFY_TS  = path.join(WORK_STATE_DIR, 'tunnel-last-notify.txt');
const LOCAL_CLOUDFLARED = path.join(WORK_STATE_DIR, 'cloudflared.exe');

const NOTIFY_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutos entre notificações

function canNotify(): boolean {
  try {
    if (!fs.existsSync(TUNNEL_NOTIFY_TS)) return true;
    const last = parseInt(fs.readFileSync(TUNNEL_NOTIFY_TS, 'utf-8').trim(), 10);
    return Date.now() - last > NOTIFY_COOLDOWN_MS;
  } catch { return true; }
}

function markNotified(): void {
  try { fs.writeFileSync(TUNNEL_NOTIFY_TS, String(Date.now())); } catch {}
}

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

async function startTunnel(): Promise<void> {
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
        if (canNotify()) { sendTelegram(url); markNotified(); }
        else { console.log('[Tunnel] Telegram cooldown ativo — notificação suprimida.'); }
      }
      if (line.trim()) process.stdout.write('[Tunnel] ' + line + '\n');
    }
  };

  proc.stdout.on('data', handleOutput);
  proc.stderr.on('data', handleOutput);

  let shutdownRequested = false;

  proc.on('exit', (code) => {
    // Cloudflared no Windows pode sair com código 255 (-1) em desconexões de rede.
    // Propagar esse código via process.exit(code) causa exit code 255 no concurrently,
    // derrubando toda a stack start:full. Em vez disso, auto-reiniciar o túnel.
    if (shutdownRequested) {
      process.exit(0);
      return;
    }
    console.log(`\n[Tunnel] cloudflared encerrou (code ${code ?? 'null'}) — reiniciando em 5s...`);
    try { fs.writeFileSync(TUNNEL_URL_FILE, ''); } catch {}
    setTimeout(() => {
      startTunnel().catch(err => {
        console.error('[Tunnel] Falha ao reiniciar:', err);
        process.exit(1);
      });
    }, 5000);
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
