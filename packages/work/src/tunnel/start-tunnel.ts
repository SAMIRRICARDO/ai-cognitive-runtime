// packages/work/src/tunnel/start-tunnel.ts
// Inicia túnel cloudflared na porta 3001 e grava a URL pública em .vraxia-work/tunnel-url.txt

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const TUNNEL_URL_FILE = path.resolve(process.cwd(), '.vraxia-work', 'tunnel-url.txt');

function isCloudflaredInstalled(): boolean {
  try {
    execSync('cloudflared --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function installCloudflared(): void {
  console.log('[Tunnel] Instalando cloudflared...');
  if (process.platform === 'win32') {
    try {
      execSync('winget install Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements', { stdio: 'inherit' });
    } catch {
      console.error('[Tunnel] Falha ao instalar via winget.');
      console.error('[Tunnel] Instale manualmente: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/');
      process.exit(1);
    }
  } else {
    console.error('[Tunnel] cloudflared não encontrado. Instale: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/');
    process.exit(1);
  }
}

async function startTunnel(): Promise<void> {
  if (!isCloudflaredInstalled()) installCloudflared();

  fs.mkdirSync(path.dirname(TUNNEL_URL_FILE), { recursive: true });

  console.log('[Tunnel] Iniciando cloudflared na porta 3001...');
  console.log('[Tunnel] Aguardando URL pública...\n');

  const proc = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:3001', '--no-autoupdate'], {
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
        console.log(`[Tunnel] Dashboard Vercel: https://vraxia-work-dashboard.vercel.app\n`);
        console.log(`[Tunnel] No dashboard, clique em ⚙ e configure a API URL como:\n  ${url}\n`);
      }
      if (line.trim()) process.stdout.write('[Tunnel] ' + line + '\n');
    }
  };

  proc.stdout.on('data', handleOutput);
  proc.stderr.on('data', handleOutput);

  proc.on('exit', (code) => {
    console.log(`\n[Tunnel] cloudflared encerrado (exit: ${code})`);
    process.exit(code ?? 0);
  });

  process.on('SIGINT', () => {
    proc.kill('SIGTERM');
    process.exit(0);
  });
}

startTunnel().catch(err => {
  console.error('[Tunnel] Erro fatal:', err);
  process.exit(1);
});
