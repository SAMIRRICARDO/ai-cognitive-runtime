// packages/work/src/tunnel/start-tunnel.ts
// Inicia túnel na porta 3001: tenta cloudflared primeiro, cai para ngrok se 429.
// Sempre notifica Telegram + atualiza api-config.json quando URL muda.

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { sendTunnelNotification } from '../notifications/telegram.js';

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
const API_CONFIG_FILE   = path.resolve(process.cwd(), 'dashboard', 'api-config.json');
const LOCAL_CLOUDFLARED = path.join(WORK_STATE_DIR, 'cloudflared.exe');

let shutdownRequested = false;
// Tracks last URL seen within this process run — used to suppress Telegram on internal restarts.
// (file is cleared at startup so the first URL of each process run always notifies)
let _lastUrlInProcess = '';

// ── Shared: notifica Telegram + persiste URL ──────────────────────────────────
// Only send Telegram when tunnel was previously DOWN (empty file at process start).
// Internal cloudflared/ngrok restarts within the same process do NOT re-notify.

function onTunnelUrl(url: string, provider: 'cloudflare' | 'ngrok'): void {
  const wasDown = _lastUrlInProcess === '';
  _lastUrlInProcess = url;

  fs.writeFileSync(TUNNEL_URL_FILE, url);

  // Atualiza api-config.json do dashboard (Vercel lê este arquivo)
  try {
    const cfg = JSON.stringify({ apiUrl: url, provider, updatedAt: new Date().toISOString() });
    fs.writeFileSync(API_CONFIG_FILE, cfg, 'utf-8');
    console.log(`[Tunnel] api-config.json atualizado: ${url}`);
  } catch (e) {
    console.warn('[Tunnel] Não foi possível atualizar api-config.json:', e);
  }

  console.log(`\n[Tunnel] ✅ URL pública (${provider}): ${url}`);
  console.log(`[Tunnel] Dashboard: https://ai-cognitive-runtime.vercel.app\n`);

  if (wasDown) {
    sendTunnelNotification(url, provider).catch(() => {});
  } else {
    console.log('[Tunnel] Túnel reiniciado com nova URL — notificação Telegram suprimida (estava ativo antes).');
  }
}

// ── Cloudflared ───────────────────────────────────────────────────────────────

function resolveCloudflared(): string {
  try { execSync('cloudflared --version', { stdio: 'ignore' }); return 'cloudflared'; } catch {}
  if (fs.existsSync(LOCAL_CLOUDFLARED)) return LOCAL_CLOUDFLARED;
  if (process.platform === 'win32') {
    try {
      execSync(
        `powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '${LOCAL_CLOUDFLARED}'"`,
        { stdio: 'inherit' }
      );
      if (fs.existsSync(LOCAL_CLOUDFLARED)) return LOCAL_CLOUDFLARED;
    } catch {}
  }
  return '';
}

async function startCloudflared(restartCount = 0): Promise<void> {
  const bin = resolveCloudflared();
  if (!bin) {
    console.log('[Tunnel] cloudflared não disponível — iniciando ngrok direto.');
    return startNgrok(0);
  }

  console.log(`[Tunnel] Iniciando cloudflared (tentativa ${restartCount + 1})...`);
  const proc = spawn(bin, ['tunnel', '--url', 'http://localhost:3001', '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let urlFound = false;
  let got429   = false;

  const handleOutput = (data: Buffer): void => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.includes('429') || line.includes('Too Many Requests') || line.includes('error code: 1015')) {
        got429 = true;
      }
      const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !urlFound) {
        urlFound = true;
        onTunnelUrl(match[0], 'cloudflare');
      }
      if (line.trim()) process.stdout.write('[cloudflared] ' + line + '\n');
    }
  };

  proc.stdout.on('data', handleOutput);
  proc.stderr.on('data', handleOutput);

  proc.on('exit', (code) => {
    if (shutdownRequested) { process.exit(0); return; }

    // 429 rate limit → muda para ngrok imediatamente
    if (got429) {
      console.log('\n[Tunnel] Cloudflare rate-limit (429) — trocando para ngrok...');
      return startNgrok(0);
    }

    const attempt = restartCount + 1;
    const maxRetries = 5;
    if (attempt > maxRetries) {
      console.log('[Tunnel] cloudflared esgotou tentativas — trocando para ngrok...');
      return startNgrok(0);
    }

    const delay = Math.min(5_000 * Math.pow(2, attempt - 1), 120_000);
    console.log(`\n[Tunnel] cloudflared encerrou (code ${code ?? 'null'}) — tentativa ${attempt}/${maxRetries}, aguardando ${delay / 1000}s...`);
    setTimeout(() => startCloudflared(attempt).catch(err => {
      console.error('[Tunnel] Erro ao reiniciar cloudflared:', err);
      startNgrok(0);
    }), delay);
  });
}

// ── ngrok ─────────────────────────────────────────────────────────────────────

function killAllNgrok(): void {
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /F /IM ngrok.exe 2>nul', { stdio: 'ignore' });
    } else {
      execSync('pkill -f ngrok 2>/dev/null || true', { stdio: 'ignore' });
    }
  } catch { /* processo pode já não existir */ }
}

async function pollNgrokUrl(): Promise<string | null> {
  // Tenta porta padrão 4040 apenas — não lê instâncias em portas alternativas
  try {
    const r = await fetch('http://localhost:4040/api/tunnels', { signal: AbortSignal.timeout(2000) });
    const d = await r.json() as { tunnels?: Array<{ proto: string; public_url: string }> };
    return d.tunnels?.find(t => t.proto === 'https')?.public_url ?? null;
  } catch { return null; }
}

async function startNgrok(restartCount = 0): Promise<void> {
  // Mata qualquer ngrok existente antes de iniciar para evitar ERR_NGROK_108
  killAllNgrok();
  await new Promise(r => setTimeout(r, 1_500)); // aguarda processos encerrarem

  console.log(`[Tunnel] Iniciando ngrok (tentativa ${restartCount + 1})...`);
  fs.mkdirSync(WORK_STATE_DIR, { recursive: true });

  const proc = spawn('ngrok', ['http', '3001', '--log=stdout'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let urlFound    = false;
  let sessionErr  = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const stopPolling = (): void => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  };

  const startPolling = (): void => {
    pollTimer = setInterval(async () => {
      if (urlFound || sessionErr) return;
      const url = await pollNgrokUrl();
      if (url) {
        urlFound = true;
        stopPolling();
        onTunnelUrl(url, 'ngrok');
      }
    }, 1_500);
  };

  const handleOutput = (data: Buffer): void => {
    const text = data.toString();
    // ERR_NGROK_108 = limite de sessões — não adianta reiniciar sem limpar
    if (text.includes('ERR_NGROK_108') || text.includes('limited to') || text.includes('authentication failed')) {
      sessionErr = true;
      stopPolling();
    }
    process.stdout.write('[ngrok] ' + text);
  };

  proc.stdout?.on('data', handleOutput);
  proc.stderr?.on('data', handleOutput);

  // Começa a poll após 2s para dar tempo do ngrok subir
  setTimeout(startPolling, 2_000);

  proc.on('exit', (code) => {
    stopPolling();
    if (shutdownRequested) { process.exit(0); return; }

    // Erro de sessão: matar tudo e esperar 30s antes de tentar novamente
    if (sessionErr) {
      console.log('\n[Tunnel] ngrok: limite de sessões (ERR_NGROK_108) — aguardando 30s para sessões expirarem...');
      killAllNgrok();
      setTimeout(() => startNgrok(restartCount).catch(() => process.exit(1)), 30_000);
      return;
    }

    const attempt = restartCount + 1;
    const maxRetries = 5;
    if (attempt > maxRetries) {
      console.error(`[Tunnel] ngrok: ${maxRetries} tentativas falharam — encerrando.`);
      process.exit(1);
      return;
    }

    const delay = Math.min(5_000 * Math.pow(2, Math.min(attempt - 1, 4)), 60_000);
    console.log(`\n[Tunnel] ngrok encerrou (code ${code ?? 'null'}) — tentativa ${attempt}/${maxRetries}, aguardando ${delay / 1000}s...`);
    setTimeout(() => startNgrok(attempt).catch(() => process.exit(1)), delay);
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

process.on('SIGINT', () => { shutdownRequested = true; process.exit(0); });
process.on('SIGTERM', () => { shutdownRequested = true; process.exit(0); });

loadEnv();
fs.mkdirSync(WORK_STATE_DIR, { recursive: true });
// Clear tunnel URL at startup so the first successful URL always notifies Telegram.
// This prevents suppression when the tunnel process is restarted (new deploy, server restart).
try { fs.writeFileSync(TUNNEL_URL_FILE, ''); } catch {}

startCloudflared(0).catch(err => {
  console.error('[Tunnel] Erro fatal no cloudflared:', err);
  startNgrok(0).catch(err2 => {
    console.error('[Tunnel] Erro fatal no ngrok:', err2);
    process.exit(1);
  });
});
