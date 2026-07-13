// packages/work/src/agents/cache.ts
// QA Cache persistente — zero tokens para perguntas já respondidas.

import fs from 'fs';
import path from 'path';

const WORK_DIR  = path.resolve(process.cwd(), '.vraxia-work');
const CACHE_PATH = path.join(WORK_DIR, 'qa-cache.json');

export class QACache {
  private cache = new Map<string, string>();
  private dirty = false;

  constructor(private filePath: string = CACHE_PATH) {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Record<string, string>;
        for (const [k, v] of Object.entries(raw)) this.cache.set(k, v);
      }
    } catch {
      // cache corrompido — começa vazio
    }
  }

  private normalize(question: string): string {
    return question
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  get(question: string): string | undefined {
    return this.cache.get(this.normalize(question));
  }

  set(question: string, answer: string): void {
    const key = this.normalize(question);
    if (this.cache.get(key) === answer) return; // já tem o mesmo valor
    this.cache.set(key, answer);
    this.dirty = true;
    this.flush();
  }

  flush(): void {
    if (!this.dirty) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const obj = Object.fromEntries(this.cache);
      fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2), 'utf-8');
      this.dirty = false;
    } catch {
      // falha silenciosa — cache em memória ainda funciona
    }
  }

  get size(): number { return this.cache.size; }

  stats(): { size: number; filePath: string; exists: boolean } {
    return { size: this.cache.size, filePath: this.filePath, exists: fs.existsSync(this.filePath) };
  }
}
