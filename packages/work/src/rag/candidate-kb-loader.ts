// candidate-kb-loader.ts
// Carrega e parseia a Candidate Knowledge Base em camadas estruturadas
// + CKOS (Candidate Knowledge Operating System) como RAG chunks adicionais

import fs from 'fs';
import path from 'path';
import { VaultChunk } from '../types/index.js';

export interface KBEntry {
  patterns: RegExp[];
  answer: string;
  source: string;
}

export interface CandidateKB {
  systemPrompt: string;
  hardRules: KBEntry[];
  faqEntries: KBEntry[];
  interviewEntries: KBEntry[];
  ragChunks: VaultChunk[];
}

const RAG_FILES = ['achievements.md', 'experience.md', 'projects.md', 'technologies.md'];

export class CandidateKBLoader {
  constructor(
    private kbPath: string,
    private ckosPath?: string,
  ) {}

  load(): CandidateKB {
    if (!fs.existsSync(this.kbPath)) {
      throw new Error(`[KB] Pasta não encontrada: ${this.kbPath}`);
    }

    const systemPrompt  = this.readFile('prompt.md');
    const hardRules     = this.parseEntries(this.readFile('hard-rules.md'), '@@rule', 'trigger', 'hard-rules');
    const faqEntries    = this.parseEntries(this.readFile('faq.md'), '@@entry', 'patterns', 'faq');
    const interviewEntries = this.parseEntries(this.readFile('interview-answers.md'), '@@entry', 'patterns', 'interview');
    const ragChunks     = this.loadRagChunks();
    const ckosChunks    = this.ckosPath ? this.loadCKOSChunks(this.ckosPath) : [];

    const allChunks = [...ragChunks, ...ckosChunks];

    console.log(
      `[KB] Carregado: ${hardRules.length} regras | ${faqEntries.length} FAQ | ` +
      `${interviewEntries.length} entrevista | ${ragChunks.length} chunks KB | ` +
      `${ckosChunks.length} chunks CKOS`
    );

    return { systemPrompt, hardRules, faqEntries, interviewEntries, ragChunks: allChunks };
  }

  private readFile(filename: string): string {
    const fullPath = path.join(this.kbPath, filename);
    if (!fs.existsSync(fullPath)) {
      console.warn(`[KB] Arquivo não encontrado: ${filename} — ignorado`);
      return '';
    }
    return fs.readFileSync(fullPath, 'utf-8');
  }

  // Parseia blocos @@entry / @@rule ... @@end
  private parseEntries(content: string, openTag: string, patternKey: string, source: string): KBEntry[] {
    if (!content) return [];
    const entries: KBEntry[] = [];

    // Divide no openTag — cada bloco é um entry
    const blocks = content.split(openTag).slice(1); // ignora antes do primeiro tag

    for (const block of blocks) {
      const endIdx = block.indexOf('@@end');
      if (endIdx === -1) continue;
      const body = block.slice(0, endIdx).trim();

      // Extrai patterns / trigger
      const patternLine = body.match(new RegExp(`^${patternKey}:\\s*(.+)$`, 'm'));
      if (!patternLine) continue;

      const rawPatterns = patternLine[1].split('|').map(p => p.trim()).filter(Boolean);
      const patterns = rawPatterns.map(p => {
        try { return new RegExp(p, 'i'); }
        catch { return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
      });

      // Extrai answer — tudo depois de "answer:" até o fim do bloco
      const answerIdx = body.indexOf('answer:');
      if (answerIdx === -1) continue;

      const afterAnswer = body.slice(answerIdx + 'answer:'.length);
      // Se o answer está na mesma linha (inline), pega a linha
      // Se está na próxima linha (multi-line), pega tudo
      const firstNewline = afterAnswer.indexOf('\n');
      const inlinePart = firstNewline === -1 ? afterAnswer : afterAnswer.slice(0, firstNewline);

      let answer: string;
      if (inlinePart.trim()) {
        // Inline: `answer: valor direto`
        answer = inlinePart.trim();
      } else {
        // Multi-line: tudo após a linha "answer:"
        answer = afterAnswer.slice(firstNewline + 1).trim();
      }

      if (answer) entries.push({ patterns, answer, source });
    }

    return entries;
  }

  // Carrega arquivos RAG como VaultChunks (para TF-IDF)
  private loadRagChunks(): VaultChunk[] {
    const chunks: VaultChunk[] = [];

    for (const filename of RAG_FILES) {
      const fullPath = path.join(this.kbPath, filename);
      if (!fs.existsSync(fullPath)) continue;

      const content = fs.readFileSync(fullPath, 'utf-8');
      const source = filename.replace('.md', '');
      const fileChunks = this.chunkByHeadings(content, source);
      chunks.push(...fileChunks);
    }

    return chunks;
  }

  private chunkByHeadings(content: string, source: string): VaultChunk[] {
    const lines = content.split('\n');
    const chunks: VaultChunk[] = [];
    let currentSection = 'root';
    let buffer: string[] = [];
    let idx = 0;

    const flush = () => {
      const text = buffer.join('\n').trim();
      if (text.length < 20) return;
      chunks.push({
        id: `kb/${source}::${currentSection}::${idx++}`,
        source: `kb/${source}`,
        section: currentSection,
        content: text,
        tags: [source],
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

  // Carrega todos os arquivos .md do CKOS como chunks RAG (ignora YAML frontmatter)
  private loadCKOSChunks(ckosPath: string): VaultChunk[] {
    const knowledgePath = path.join(ckosPath, 'knowledge');
    if (!fs.existsSync(knowledgePath)) {
      console.warn(`[CKOS] Pasta knowledge não encontrada: ${knowledgePath}`);
      return [];
    }

    const chunks: VaultChunk[] = [];
    const mdFiles = this.walkMd(knowledgePath);

    for (const filePath of mdFiles) {
      try {
        let content = fs.readFileSync(filePath, 'utf-8');
        content = this.stripFrontmatter(content);

        // Deriva categoria do path relativo (ex: "01_profile/master_profile")
        const rel     = path.relative(knowledgePath, filePath).replace(/\\/g, '/');
        const source  = `ckos/${rel.replace('.md', '')}`;
        const category = rel.split('/')[0] ?? 'ckos';

        const fileChunks = this.chunkCKOS(content, source, category);
        chunks.push(...fileChunks);
      } catch {
        // ignora arquivos ilegíveis
      }
    }

    return chunks;
  }

  // Fragmenta conteúdo CKOS em chunks por heading H2/H3
  private chunkCKOS(content: string, source: string, category: string): VaultChunk[] {
    const lines = content.split('\n');
    const chunks: VaultChunk[] = [];
    let currentSection = 'intro';
    let buffer: string[] = [];
    let idx = 0;

    const flush = () => {
      const text = buffer.join('\n').trim();
      if (text.length < 30) return;
      chunks.push({
        id: `${source}::${currentSection}::${idx++}`,
        source,
        section: currentSection,
        content: text,
        tags: [category, 'ckos'],
      });
    };

    for (const line of lines) {
      // Divide em H2 e H3 (## e ###)
      const h2 = line.match(/^#{2,3}\s+(.+)/);
      if (h2) {
        flush();
        buffer = [];
        currentSection = h2[1].trim();
      } else {
        buffer.push(line);
      }
    }
    flush();
    return chunks;
  }

  // Strip YAML frontmatter (--- ... ---)
  private stripFrontmatter(content: string): string {
    if (!content.startsWith('---')) return content;
    const end = content.indexOf('\n---', 3);
    if (end === -1) return content;
    return content.slice(end + 4).trimStart();
  }

  // Caminha recursivamente e retorna todos os .md
  private walkMd(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.walkMd(full));
      } else if (entry.name.endsWith('.md')) {
        results.push(full);
      }
    }
    return results;
  }
}
