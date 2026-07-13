// candidate-kb-retriever.ts
// Hierarquia de consulta em 5 camadas — zero LLM quando possível

import { VaultChunk } from '../types/index.js';
import { VaultRetriever } from './retriever.js';
import { CandidateKB, KBEntry } from './candidate-kb-loader.js';

export class CandidateKBRetriever {
  private ragRetriever: VaultRetriever;

  constructor(private kb: CandidateKB) {
    this.ragRetriever = new VaultRetriever();
    if (kb.ragChunks.length) {
      this.ragRetriever.index(kb.ragChunks);
    }
  }

  get systemPrompt(): string { return this.kb.systemPrompt; }
  get hardRulesText(): string {
    return this.kb.hardRules
      .map(r => `- ${r.patterns[0]?.source ?? ''}: ${r.answer}`)
      .join('\n');
  }

  // ── Camada 1: Hard Rules (sempre verificado primeiro) ────────────────────────
  lookupHardRule(question: string): string | null {
    return this.matchEntries(question, this.kb.hardRules);
  }

  // ── Camadas 2+3: FAQ e Interview (zero LLM) ──────────────────────────────────
  lookupExact(question: string): string | null {
    return (
      this.matchEntries(question, this.kb.faqEntries) ??
      this.matchEntries(question, this.kb.interviewEntries)
    );
  }

  // ── Camada 4: RAG semântico (TF-IDF local) ────────────────────────────────────
  retrieveContext(question: string, topK = 4): VaultChunk[] {
    if (!this.kb.ragChunks.length) return [];
    return this.ragRetriever.retrieve(question, topK);
  }

  buildContext(question: string, topK = 4): string {
    const chunks = this.retrieveContext(question, topK);
    if (!chunks.length) return '';
    return chunks
      .map(c => `[${c.source} > ${c.section}]\n${c.content}`)
      .join('\n\n---\n\n');
  }

  // ── Match engine: verifica todos os padrões de uma lista ─────────────────────
  private matchEntries(question: string, entries: KBEntry[]): string | null {
    const normalized = question
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim();

    for (const entry of entries) {
      for (const pattern of entry.patterns) {
        if (pattern.test(normalized) || pattern.test(question.trim())) {
          return entry.answer;
        }
      }
    }
    return null;
  }
}
