// packages/work/src/remote-dev/executor/interface.ts
// Executor interface — pluggable execution backend

import type { RdaJob, ExecutorResult } from '../types/index.js';

export interface StreamChunk {
  type:    'stdout' | 'stderr' | 'status' | 'file_change' | 'complete';
  content: string;
  ts:      number;
}

export type StreamCallback = (chunk: StreamChunk) => void;

export interface Executor {
  readonly id:   string;
  readonly name: string;

  /** Check if executor binary is available on this machine */
  isAvailable(): Promise<boolean>;

  /** Get executor version string */
  version(): Promise<string | null>;

  /** Execute the job — streams output via onChunk, resolves when done */
  execute(job: RdaJob, onChunk: StreamCallback): Promise<ExecutorResult>;

  /** Gracefully stop current execution */
  stop(): Promise<void>;

  /** Resume a paused execution (if supported) */
  resume(): Promise<void>;

  /** Cancel and discard current execution */
  cancel(): Promise<void>;

  /** Current execution status */
  status(): 'idle' | 'running' | 'paused' | 'stopping';

  /** Health check */
  health(): Promise<{ ok: boolean; detail?: string }>;
}
