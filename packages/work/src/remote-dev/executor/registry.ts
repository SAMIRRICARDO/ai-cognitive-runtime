// packages/work/src/remote-dev/executor/registry.ts
// ExecutorRegistry — factory + lookup for all executor implementations

import type { Executor } from './interface.js';
import { ClaudeCodeExecutor } from './claude-code.js';
import type { ExecutorId, ExecutorInfo } from '../types/index.js';

export class ExecutorRegistry {
  private static _instance: ExecutorRegistry | null = null;
  private readonly _executors = new Map<string, Executor>();

  private constructor() {
    this.register(new ClaudeCodeExecutor());
    // Future: this.register(new CodexExecutor());
    // Future: this.register(new GeminiExecutor());
  }

  static getInstance(): ExecutorRegistry {
    if (!this._instance) this._instance = new ExecutorRegistry();
    return this._instance;
  }

  register(executor: Executor): void {
    this._executors.set(executor.id, executor);
  }

  get(id: ExecutorId | string): Executor | null {
    return this._executors.get(id) ?? null;
  }

  async listAvailable(): Promise<ExecutorInfo[]> {
    const results: ExecutorInfo[] = [];
    for (const [id, ex] of this._executors) {
      const available = await ex.isAvailable().catch(() => false);
      const version   = available ? await ex.version().catch(() => null) : null;
      results.push({ id: id as ExecutorId, name: ex.name, description: '', available, version: version ?? undefined });
    }
    return results;
  }
}
