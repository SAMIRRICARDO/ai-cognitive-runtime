// packages/work/src/remote-dev/executor/claude-code.ts
// ClaudeCodeExecutor — first implementation of the Executor interface

import { spawn, type ChildProcess } from 'child_process';
import { execSync } from 'child_process';
import path from 'path';
import type { Executor, StreamCallback } from './interface.js';
import type { RdaJob, ExecutorResult } from '../types/index.js';

export class ClaudeCodeExecutor implements Executor {
  readonly id   = 'claude-code';
  readonly name = 'Claude Code';

  private _proc:   ChildProcess | null = null;
  private _status: ReturnType<Executor['status']> = 'idle';

  async isAvailable(): Promise<boolean> {
    try { execSync('claude --version', { stdio: 'ignore' }); return true; } catch { return false; }
  }

  async version(): Promise<string | null> {
    try {
      return execSync('claude --version', { encoding: 'utf-8' }).trim();
    } catch { return null; }
  }

  async execute(job: RdaJob, onChunk: StreamCallback): Promise<ExecutorResult> {
    if (this._status === 'running') throw new Error('Executor already running');
    this._status = 'running';

    const start      = Date.now();
    const outputBuf: string[] = [];
    const filesChanged: string[] = [];
    let tokensUsed = 0;

    // Build claude CLI args
    // --print: non-interactive, print response and exit
    // --dangerously-skip-permissions: allow file edits (controlled by job.permissions)
    const args: string[] = ['--print'];

    if (job.permissions.editFiles) args.push('--dangerously-skip-permissions');

    // Append permission context to prompt
    const permContext = buildPermContext(job);
    const fullPrompt  = `${permContext}\n\n${job.prompt}`;

    return new Promise((resolve, reject) => {
      try {
        this._proc = spawn('claude', [...args, fullPrompt], {
          cwd:   job.projectPath,
          stdio: ['ignore', 'pipe', 'pipe'],
          env:   { ...process.env, FORCE_COLOR: '0' },
        });
      } catch (e) {
        this._status = 'idle';
        reject(new Error(`Failed to spawn claude: ${String(e)}`));
        return;
      }

      this._proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        outputBuf.push(text);
        onChunk({ type: 'output', content: text, ts: Date.now() });

        // Detect file changes from Claude's output patterns
        const fileMatches = text.matchAll(/(?:Updated|Created|Modified|Wrote) (.+\.\w+)/g);
        for (const m of fileMatches) {
          const f = m[1].trim();
          if (!filesChanged.includes(f)) filesChanged.push(f);
          onChunk({ type: 'file_change', content: f, ts: Date.now() });
        }

        // Extract token usage if present in output
        const tokenMatch = text.match(/(\d+)\s+tokens?/i);
        if (tokenMatch) tokensUsed = parseInt(tokenMatch[1], 10);
      });

      this._proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        outputBuf.push(text);
        onChunk({ type: 'error', content: text, ts: Date.now() });
      });

      this._proc.on('error', (err) => {
        this._status = 'idle';
        this._proc   = null;
        reject(err);
      });

      this._proc.on('exit', (code) => {
        this._status = 'idle';
        this._proc   = null;
        const output = outputBuf.join('');
        const result: ExecutorResult = {
          success:      code === 0,
          output,
          filesChanged,
          tokensUsed,
          durationMs:   Date.now() - start,
          exitCode:     code ?? -1,
        };
        onChunk({ type: 'complete', content: JSON.stringify({ exitCode: code }), ts: Date.now() });
        resolve(result);
      });
    });
  }

  async stop(): Promise<void> {
    if (this._proc && this._status === 'running') {
      this._status = 'stopping';
      this._proc.kill('SIGTERM');
    }
  }

  async resume(): Promise<void> {
    // Claude Code doesn't support resume; no-op
  }

  async cancel(): Promise<void> {
    if (this._proc) {
      this._proc.kill('SIGKILL');
      this._proc   = null;
      this._status = 'idle';
    }
  }

  status(): ReturnType<Executor['status']> { return this._status; }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    const avail = await this.isAvailable();
    if (!avail) return { ok: false, detail: 'claude CLI not found in PATH' };
    const ver = await this.version();
    return { ok: true, detail: ver ?? undefined };
  }
}

function buildPermContext(job: RdaJob): string {
  const p = job.permissions;
  const allowed: string[] = [];
  const denied:  string[] = [];

  if (p.editFiles) allowed.push('edit/create/delete files'); else denied.push('file edits');
  if (p.runTests)  allowed.push('run tests');                 else denied.push('running tests');
  allowed.push('git commit');
  if (p.deploy)    allowed.push('deploy');                    else denied.push('deploy');
  if (p.docker)    allowed.push('docker commands');           else denied.push('docker');
  if (p.terminal)  allowed.push('terminal commands');         else denied.push('arbitrary shell');

  return [
    `[VRAXIA Remote Dev — Permissions]`,
    `Allowed: ${allowed.join(', ') || 'read-only'}`,
    `NOT allowed: ${denied.join(', ') || 'none'}`,
    `Project: ${path.basename(job.projectPath)}`,
    `Mode: ${job.mode}`,
  ].join('\n');
}
