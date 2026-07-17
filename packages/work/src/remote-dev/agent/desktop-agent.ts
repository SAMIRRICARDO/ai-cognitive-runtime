#!/usr/bin/env node
// packages/work/src/remote-dev/agent/desktop-agent.ts
// VRAXIA Desktop Agent — runs locally, connects to VRAXIA server via WebSocket
//
// Usage:
//   npx tsx src/remote-dev/agent/desktop-agent.ts --server http://localhost:3001 --token <token>
//   npx tsx src/remote-dev/agent/desktop-agent.ts --register --name "My Machine"

import { program } from 'commander';
import { WebSocket } from 'ws';
import { execSync, exec } from 'child_process';
import { createHmac } from 'crypto';
import os from 'os';
import fs from 'fs';
import path from 'path';

program
  .option('--server <url>',  'VRAXIA server URL (default: http://localhost:3001)', 'http://localhost:3001')
  .option('--token <token>', 'Device auth token')
  .option('--register',      'Register this device and print token, then exit')
  .option('--name <name>',   'Device name for registration', os.hostname())
  .option('--config <path>', 'Path to config JSON file')
  .parse();

const opts = program.opts<{
  server: string; token?: string; register?: boolean;
  name: string; config?: string;
}>();

// Load config from file if provided
let TOKEN = opts.token ?? '';
let SERVER = opts.server;

if (opts.config && fs.existsSync(opts.config)) {
  try {
    const cfg = JSON.parse(fs.readFileSync(opts.config, 'utf-8')) as { token?: string; server?: string };
    if (cfg.token)  TOKEN  = cfg.token;
    if (cfg.server) SERVER = cfg.server;
  } catch { /* ignore */ }
}

// ── Workspace Discovery ─────────────────────────────────────────────────────

async function discoverWorkspace() {
  const projects: Array<{
    name: string; path: string; git: boolean; branch?: string;
    framework?: string; hasTests: boolean; hasDocker: boolean;
  }> = [];

  const scanDirs = [
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'Projects'),
    path.join(os.homedir(), 'Documents'),
    'C:\\AI-LAB',
    'C:\\Projects',
  ].filter(d => fs.existsSync(d));

  for (const base of scanDirs) {
    try {
      const entries = fs.readdirSync(base, { withFileTypes: true });
      for (const e of entries.slice(0, 20)) {
        if (!e.isDirectory()) continue;
        const p = path.join(base, e.name);
        const hasPackageJson = fs.existsSync(path.join(p, 'package.json'));
        const hasPyproject   = fs.existsSync(path.join(p, 'pyproject.toml'));
        const hasGit         = fs.existsSync(path.join(p, '.git'));
        if (!hasPackageJson && !hasPyproject && !hasGit) continue;

        let branch: string | undefined;
        if (hasGit) {
          try { branch = execSync(`git -C "${p}" branch --show-current`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
        }

        let framework: string | undefined;
        if (hasPackageJson) {
          try {
            const pkg = JSON.parse(fs.readFileSync(path.join(p, 'package.json'), 'utf-8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            if (deps.next)    framework = 'next';
            else if (deps.vite)    framework = 'vite';
            else if (deps.express) framework = 'express';
            else if (deps.react)   framework = 'react';
          } catch {}
        }

        projects.push({
          name:      e.name,
          path:      p,
          git:       hasGit,
          branch,
          framework,
          hasTests:  fs.existsSync(path.join(p, 'vitest.config.ts')) ||
                     fs.existsSync(path.join(p, 'jest.config.js')) ||
                     fs.existsSync(path.join(p, 'pytest.ini')),
          hasDocker: fs.existsSync(path.join(p, 'Dockerfile')) ||
                     fs.existsSync(path.join(p, 'docker-compose.yml')),
        });
      }
    } catch { /* skip unreadable dirs */ }
  }

  const nodeVersion   = process.version;
  let npmVersion      = 'unknown';
  let gitVersion      = 'unknown';
  let dockerAvail     = false;
  let pythonAvail     = false;

  try { npmVersion  = execSync('npm --version',    { encoding: 'utf-8', stdio: 'pipe' }).trim(); } catch {}
  try { gitVersion  = execSync('git --version',    { encoding: 'utf-8', stdio: 'pipe' }).trim().replace('git version ', ''); } catch {}
  try { execSync('docker --version', { stdio: 'ignore' }); dockerAvail = true; } catch {}
  try { execSync('python --version', { stdio: 'ignore' }); pythonAvail = true; } catch {}
  try { execSync('python3 --version', { stdio: 'ignore' }); pythonAvail = true; } catch {}

  return { projects, nodeVersion, npmVersion, gitVersion, dockerAvail, pythonAvail };
}

// ── Registration ────────────────────────────────────────────────────────────

async function registerDevice() {
  const url = `${SERVER}/api/rda/devices/register`;
  const body = JSON.stringify({
    name:        opts.name,
    platform:    process.platform,
    hostname:    os.hostname(),
    nodeVersion: process.version,
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error(`[Agent] Registration failed: ${err}`);
    process.exit(1);
  }

  const data = await resp.json() as { device: { id: string; name: string }; token: string };
  console.log(`[Agent] Registered!`);
  console.log(`Device ID:  ${data.device.id}`);
  console.log(`Device Name: ${data.device.name}`);
  console.log(`Token:       ${data.token}`);
  console.log('');
  console.log('Save this token — it will NOT be shown again.');
  console.log(`Start the agent with: npx tsx src/remote-dev/agent/desktop-agent.ts --token ${data.token}`);
}

// ── Agent Main Loop ──────────────────────────────────────────────────────────

async function startAgent() {
  if (!TOKEN) {
    console.error('[Agent] --token required. Run with --register first.');
    process.exit(1);
  }

  const wsUrl = SERVER.replace(/^http/, 'ws') + '/rda';
  console.log(`[Agent] Connecting to ${wsUrl}...`);

  let reconnectDelay = 2000;
  const MAX_DELAY = 30000;

  function connect() {
    const ws = new WebSocket(wsUrl, { headers: { 'x-rda-agent': 'true' } });

    ws.on('open', async () => {
      console.log('[Agent] Connected');
      reconnectDelay = 2000;

      // Authenticate
      ws.send(JSON.stringify({ type: 'auth', payload: { token: TOKEN }, ts: Date.now() }));

      // Start heartbeat
      const hb = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'heartbeat', payload: {}, ts: Date.now() }));
        }
      }, 15000);

      ws.on('close', () => clearInterval(hb));

      // Send workspace info
      try {
        const workspace = await discoverWorkspace();
        ws.send(JSON.stringify({ type: 'workspace_info', payload: workspace, ts: Date.now() }));
        console.log(`[Agent] Workspace: ${workspace.projects.length} projects discovered`);
      } catch { /* non-critical */ }
    });

    ws.on('message', async (raw) => {
      let msg: { type: string; payload: unknown };
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'auth_ok') {
        const p = msg.payload as { deviceId: string; name: string };
        console.log(`[Agent] Authenticated as "${p.name}" (${p.deviceId})`);
        return;
      }

      if (msg.type === 'auth_error') {
        console.error('[Agent] Auth failed — check token');
        ws.close();
        process.exit(1);
        return;
      }

      if (msg.type === 'job_assigned') {
        const job = (msg.payload as { job: Record<string, unknown> }).job;
        console.log(`[Agent] Job received: ${job['id']} — ${job['mode']} — ${String(job['prompt']).slice(0, 60)}`);
        executeJob(ws, job).catch(e => {
          console.error('[Agent] Job execution error:', e);
          ws.send(JSON.stringify({
            type: 'job_event',
            payload: { jobId: job['id'], eventType: 'status_change', payload: { status: 'error', error: String(e) } },
            ts: Date.now(),
          }));
        });
        return;
      }

      if (msg.type === 'job_cancel') {
        const { jobId } = msg.payload as { jobId: string };
        console.log(`[Agent] Cancel requested for job ${jobId}`);
        // TODO: signal the running executor to stop
        return;
      }

      if (msg.type === 'heartbeat_ack') { return; }
    });

    ws.on('error', (err) => {
      console.error('[Agent] WS error:', err.message);
    });

    ws.on('close', (code, reason) => {
      console.log(`[Agent] Disconnected (${code}). Reconnecting in ${reconnectDelay / 1000}s...`);
      setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_DELAY);
        connect();
      }, reconnectDelay);
    });
  }

  connect();
}

async function executeJob(ws: WebSocket, job: Record<string, unknown>) {
  const jobId   = job['id'] as string;
  const prompt  = job['prompt'] as string;
  const projPath = job['projectPath'] as string ?? process.cwd();
  const execId  = (job['executorId'] as string) ?? 'claude-code';

  function emit(eventType: string, payload: unknown) {
    ws.send(JSON.stringify({
      type: 'job_event',
      payload: { jobId, eventType, payload },
      ts: Date.now(),
    }));
  }

  emit('status_change', { status: 'preparing' });

  // Spawn the executor
  const { ClaudeCodeExecutor } = await import('../executor/claude-code.js');
  const executor = new ClaudeCodeExecutor();

  const available = await executor.isAvailable();
  if (!available) {
    emit('status_change', { status: 'error', error: `Executor ${execId} not available on this machine` });
    return;
  }

  emit('status_change', { status: 'analyzing' });

  const result = await executor.execute(
    { ...job, id: jobId, prompt, projectPath: projPath } as never,
    (chunk) => {
      if (chunk.type === 'file_change') {
        emit('file_changed', { file: chunk.content });
      } else if (chunk.type === 'complete') {
        // handled below
      } else {
        emit('stream_chunk', { type: chunk.type, content: chunk.content });
      }
    },
  );

  emit('status_change', {
    status: result.success ? 'completed' : 'error',
    filesChanged: result.filesChanged,
    tokensUsed:   result.tokensUsed,
    durationMs:   result.durationMs,
    exitCode:     result.exitCode,
  });

  console.log(`[Agent] Job ${jobId} ${result.success ? 'DONE' : 'FAILED'} in ${result.durationMs}ms`);
}

// ── Entry ────────────────────────────────────────────────────────────────────

if (opts.register) {
  registerDevice().catch(e => { console.error(e); process.exit(1); });
} else {
  startAgent().catch(e => { console.error(e); process.exit(1); });
}
