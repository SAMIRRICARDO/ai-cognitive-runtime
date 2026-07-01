// packages/work/src/rag/retriever.ts
// Cheap mode: TF-IDF local sem embedding externo — zero custo de API

import { VaultChunk } from '../types/index.js';

export class VaultRetriever {
  private chunks: VaultChunk[] = [];

  index(chunks: VaultChunk[]): void {
    this.chunks = chunks;
    console.log(`[Retriever] ${chunks.length} chunks indexados.`);
  }

  // Retrieval filtrado por padrões de source — usado pelo SenseLayer do QuestionnaireAgent
  retrieveScoped(query: string, sourcePatterns: string[], topK = 5): VaultChunk[] {
    if (!sourcePatterns.length) return this.retrieve(query, topK);

    const pool = this.chunks.filter(c =>
      sourcePatterns.some(p => c.source.toLowerCase().includes(p.toLowerCase()))
    );
    if (!pool.length) return this.retrieve(query, topK); // fallback ao corpus completo

    const queryTokens = this.tokenize(query);
    return pool
      .map(chunk => ({ chunk, score: this.tfidfScore(queryTokens, chunk) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .filter(s => s.score > 0)
      .map(s => s.chunk);
  }

  retrieve(query: string, topK = 5): VaultChunk[] {
    if (!this.chunks.length) return [];

    const queryTokens = this.tokenize(query);
    const scored = this.chunks.map(chunk => ({
      chunk,
      score: this.tfidfScore(queryTokens, chunk),
    }));

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .filter(s => s.score > 0)
      .map(s => s.chunk);
  }

  buildContext(query: string, topK = 5): string {
    const relevant = this.retrieve(query, topK);
    if (!relevant.length) return '';

    return relevant
      .map(c => `[${c.source} > ${c.section}]\n${c.content}`)
      .join('\n\n---\n\n');
  }

  private tfidfScore(queryTokens: string[], chunk: VaultChunk): number {
    const chunkTokens = this.tokenize(chunk.content + ' ' + chunk.section);
    const chunkSet = new Set(chunkTokens);

    let score = 0;
    for (const token of queryTokens) {
      if (chunkSet.has(token)) {
        // TF: frequência no chunk
        const tf = chunkTokens.filter(t => t === token).length / chunkTokens.length;
        // IDF simplificado: boost para tokens menos comuns
        const df = this.chunks.filter(c =>
          this.tokenize(c.content).includes(token)
        ).length;
        const idf = Math.log(this.chunks.length / (df + 1));
        score += tf * idf;
      }
    }

    // Boost por tags
    for (const tag of chunk.tags) {
      if (queryTokens.some(t => tag.toLowerCase().includes(t))) {
        score += 0.5;
      }
    }

    return score;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove acentos
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2);
  }
}
