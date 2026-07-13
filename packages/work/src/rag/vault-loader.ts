// packages/work/src/rag/vault-loader.ts

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { VaultChunk } from '../types/index.js';

export class ObsidianVaultLoader {
  constructor(private vaultPath: string) {}

  load(subfolder = 'vraxia-work'): VaultChunk[] {
    const basePath = path.join(this.vaultPath, subfolder);

    if (!fs.existsSync(basePath)) {
      throw new Error(`Vault subfolder não encontrado: ${basePath}`);
    }

    const files = this.walkDir(basePath, '.md');
    const chunks: VaultChunk[] = [];

    for (const file of files) {
      const raw = fs.readFileSync(file, 'utf-8');
      const { data: frontmatter, content } = matter(raw);
      const relative = path.relative(basePath, file);
      const tags: string[] = frontmatter.tags ?? [];

      const fileChunks = this.chunkByHeadings(content, relative, tags);
      chunks.push(...fileChunks);
    }

    console.log(`[VaultLoader] ${chunks.length} chunks carregados de ${files.length} arquivos.`);
    return chunks;
  }

  private chunkByHeadings(content: string, source: string, tags: string[]): VaultChunk[] {
    const lines = content.split('\n');
    const chunks: VaultChunk[] = [];

    let currentSection = 'root';
    let buffer: string[] = [];

    const flush = () => {
      const text = buffer.join('\n').trim();
      if (text.length < 20) return; // ignora chunks muito pequenos
      chunks.push({
        id: `${source}::${currentSection}::${chunks.length}`,
        source,
        section: currentSection,
        content: text,
        tags,
      });
    };

    for (const line of lines) {
      const headingMatch = line.match(/^#{1,3}\s+(.+)/);
      if (headingMatch) {
        flush();
        buffer = [];
        currentSection = headingMatch[1].trim();
      } else {
        buffer.push(line);
      }
    }
    flush();

    return chunks;
  }

  private walkDir(dir: string, ext: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.walkDir(fullPath, ext));
      } else if (entry.name.endsWith(ext)) {
        results.push(fullPath);
      }
    }
    return results;
  }
}
