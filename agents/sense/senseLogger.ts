import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOG_FILE = path.join(ROOT, 'data', 'sense-events.jsonl');

export interface SenseEvent {
  ts: string;
  stage: 'filtered_out' | 'triaged_out' | 'classified' | 'handoff' | 'error';
  prospect: string;
  company: string;
  role: string;
  message_snippet: string;
  intent?: string;
  variant?: string;
  score?: number;
  detail: string;
}

export function logSenseEvent(e: SenseEvent): void {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify(e) + '\n', 'utf-8');
}

function readAll(): SenseEvent[] {
  if (!fs.existsSync(LOG_FILE)) return [];
  return fs.readFileSync(LOG_FILE, 'utf-8')
    .split('\n').filter(Boolean)
    .map(l => JSON.parse(l) as SenseEvent);
}

export function getSenseStats() {
  const events = readAll();
  return {
    total:      events.length,
    filtered:   events.filter(e => e.stage === 'filtered_out').length,
    triaged:    events.filter(e => e.stage === 'triaged_out').length,
    classified: events.filter(e => e.stage === 'classified').length,
    handoffs:   events.filter(e => e.stage === 'handoff').length,
  };
}

export function getRecentEvents(limit = 20): SenseEvent[] {
  const all = readAll();
  return all.slice(-limit).reverse();
}
