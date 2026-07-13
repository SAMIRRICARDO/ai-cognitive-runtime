// packages/work/src/application/ApplicationTracer.ts

import fs from 'fs';
import path from 'path';
import { TraceEvent, StateTransition } from './types.js';

export class ApplicationTracer {
  private events: TraceEvent[] = [];
  private transitions: StateTransition[] = [];
  private stepStart = Date.now();
  readonly traceId: string;

  constructor(
    readonly jobId: string,
    private evidenceDir: string,
    traceId?: string,
  ) {
    this.traceId = traceId ??
      `trc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  markStep(step: string): void {
    this.stepStart = Date.now();
    // Provides a reference point for the next addEvent call
    void step;
  }

  addEvent(event: Omit<TraceEvent, 'timestamp' | 'durationMs'> & { durationMs?: number }): void {
    this.events.push({
      ...event,
      timestamp: new Date().toISOString(),
      durationMs: event.durationMs ?? (Date.now() - this.stepStart),
    });
  }

  addTransition(t: StateTransition): void {
    this.transitions.push(t);
  }

  addError(step: string, url: string, err: unknown, screenshotFile?: string): void {
    const error = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    this.addEvent({ step, url, result: 'error', error, stack, screenshotFile });
  }

  async flush(): Promise<void> {
    fs.mkdirSync(this.evidenceDir, { recursive: true });

    fs.writeFileSync(
      path.join(this.evidenceDir, 'trace.json'),
      JSON.stringify({ traceId: this.traceId, jobId: this.jobId, events: this.events }, null, 2),
      'utf-8',
    );

    fs.writeFileSync(
      path.join(this.evidenceDir, 'timeline.json'),
      JSON.stringify({
        traceId: this.traceId,
        jobId: this.jobId,
        transitions: this.transitions,
        totalEvents: this.events.length,
        totalDurationMs: this.transitions.reduce((s, t) => s + t.durationMs, 0),
      }, null, 2),
      'utf-8',
    );
  }
}
