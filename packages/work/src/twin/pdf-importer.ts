// packages/work/src/twin/pdf-importer.ts
// PDF/TXT → Haiku normaliza → CandidateTwin → QA cache + vault hints

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { TwinStore } from './candidate-twin.js';
import { QACache } from '../agents/cache.js';
import { CandidateTwin } from '../types/index.js';

const WORK_DIR = path.resolve(process.cwd(), '.vraxia-work');

// ── Text extraction ──────────────────────────────────────────────────────────

function extractText(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.txt' || ext === '.md') {
    return fs.readFileSync(filePath, 'utf-8');
  }
  if (ext === '.pdf') {
    // Try pdftotext (Poppler) — available on most Linux systems
    try {
      return execSync(`pdftotext "${filePath}" -`, { timeout: 15000 }).toString();
    } catch {
      // Fallback: extract printable ASCII from PDF binary
      const buf = fs.readFileSync(filePath);
      const raw = buf.toString('binary');
      // Extract text between BT/ET PDF operators and plain readable chunks
      const chunks: string[] = [];
      const btEtRx = /BT([\s\S]*?)ET/g;
      let m: RegExpExecArray | null;
      while ((m = btEtRx.exec(raw)) !== null) {
        // Pull string literals from PDF stream
        const strRx = /\(([^)]{2,200})\)/g;
        let sm: RegExpExecArray | null;
        while ((sm = strRx.exec(m[1])) !== null) {
          const s = sm[1].replace(/\\r|\\n/g, ' ').replace(/[^\x20-\x7E]/g, '');
          if (s.trim().length > 3) chunks.push(s.trim());
        }
      }
      if (chunks.length > 10) return chunks.join(' ');
      // Last resort: readable ASCII runs
      return raw.replace(/[^\x20-\x7E\n]/g, ' ').replace(/\s{3,}/g, '\n').slice(0, 20000);
    }
  }
  throw new Error(`Formato não suportado: ${ext}. Use .pdf, .txt ou .md`);
}

// ── Haiku extraction ─────────────────────────────────────────────────────────

const EXTRACT_PROMPT = (text: string) => `
Você receberá o texto de um currículo/CV em português ou inglês.
Extraia TODOS os dados disponíveis e retorne um JSON válido com a estrutura abaixo.
Use string vazia "" para campos não encontrados. Não invente dados.

Texto do currículo:
---
${text.slice(0, 12000)}
---

Retorne APENAS o JSON, sem markdown:
{
  "identity": {
    "name": "",
    "email": "",
    "phone": "",
    "location": "",
    "languages": [],
    "linkedin": "",
    "github": ""
  },
  "professional": {
    "currentTitle": "",
    "yearsExp": 0,
    "seniority": "senior",
    "skills": [],
    "stack": [],
    "industries": []
  },
  "projects": [
    {"name":"","description":"","tech":[],"url":"","highlights":[]}
  ],
  "preferences": {
    "targetSalary": 0,
    "currency": "BRL",
    "remote": true,
    "workTypes": [],
    "locations": [],
    "companySizes": []
  },
  "behavioral": {
    "strengths": [],
    "weaknesses": [],
    "motivations": [],
    "values": [],
    "workStyle": ""
  },
  "history": [
    {"company":"","role":"","period":"","highlights":[],"tech":[]}
  ],
  "financial": {
    "currentSalary": 0,
    "targetSalary": 0,
    "currency": "BRL",
    "negotiable": true
  },
  "learning": {
    "certifications": [],
    "studying": [],
    "goals": []
  }
}
`;

export interface ImportResult {
  twin: CandidateTwin;
  extractedFields: string[];
  warnings: string[];
  qaEntriesAdded: number;
}

export class PDFImporter {
  private client: Anthropic;
  private store: TwinStore;
  private qaCache: QACache;

  constructor(store: TwinStore, apiKey?: string) {
    this.client = new Anthropic({ apiKey });
    this.store  = store;
    this.qaCache = new QACache();
  }

  async import(filePath: string): Promise<ImportResult> {
    console.log(`[PDFImporter] Extraindo texto de: ${filePath}`);
    const text = extractText(filePath);
    console.log(`[PDFImporter] ${text.length} chars extraídos. Enviando para Haiku...`);

    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: EXTRACT_PROMPT(text) }],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';
    let partial: Partial<CandidateTwin>;
    try {
      partial = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch {
      throw new Error('[PDFImporter] Haiku retornou JSON inválido. Tente de novo ou envie .txt');
    }

    // Merge into existing twin
    const twin = this.store.patch(partial);

    // Detect which fields were populated
    const extractedFields = this.detectFields(partial);

    // Populate QA cache with identity data
    const qaEntries = this.populateQACache(twin);

    // Write vault hint file
    this.writeVaultHint(twin, filePath);

    const warnings: string[] = [];
    if (!twin.identity.email) warnings.push('E-mail não detectado no CV');
    if (!twin.professional.yearsExp) warnings.push('Anos de experiência não detectados');
    if (!twin.history.length) warnings.push('Histórico profissional não detectado');

    console.log(`[PDFImporter] ✅ ${extractedFields.length} campos extraídos, ${qaEntries} entradas QA adicionadas`);
    return { twin, extractedFields, warnings, qaEntriesAdded: qaEntries };
  }

  private detectFields(partial: Partial<CandidateTwin>): string[] {
    const fields: string[] = [];
    const check = (section: string, obj: unknown) => {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (v && (typeof v !== 'number' || v > 0) && (!Array.isArray(v) || v.length > 0)) {
          fields.push(`${section}.${k}`);
        }
      }
    };
    if (partial.identity)     check('identity',     partial.identity);
    if (partial.professional) check('professional', partial.professional);
    if (partial.financial)    check('financial',    partial.financial);
    if (partial.behavioral)   check('behavioral',   partial.behavioral);
    if (partial.learning)     check('learning',     partial.learning);
    if (partial.projects?.length)  fields.push(`projects[${partial.projects.length}]`);
    if (partial.history?.length)   fields.push(`history[${partial.history.length}]`);
    return fields;
  }

  private populateQACache(twin: CandidateTwin): number {
    let added = 0;
    const set = (q: string, a: string) => {
      if (a && a.trim()) { this.qaCache.set(q, a); added++; }
    };
    const { identity, professional, financial } = twin;
    set('Qual seu nome completo?', identity.name);
    set('Qual seu e-mail?', identity.email);
    set('Qual seu telefone?', identity.phone);
    set('Qual sua cidade/localização?', identity.location);
    set('Qual seu cargo atual?', professional.currentTitle);
    set('Quantos anos de experiência você tem?', String(professional.yearsExp || 15));
    set('Qual sua pretensão salarial?', `R$ ${(financial.targetSalary || 14000).toLocaleString('pt-BR')}`);
    set('Qual seu LinkedIn?', identity.linkedin);
    set('Qual seu GitHub?', identity.github);
    set('Quais são suas principais habilidades técnicas?', professional.skills.slice(0, 8).join(', '));
    return added;
  }

  private writeVaultHint(twin: CandidateTwin, sourcePath: string): void {
    const hintPath = path.join(WORK_DIR, 'twin-summary.md');
    const lines = [
      `# Digital Twin — ${twin.identity.name}`,
      `> Importado de: ${path.basename(sourcePath)} em ${new Date().toLocaleDateString('pt-BR')}`,
      '',
      `## Identidade`,
      `- **Cargo:** ${twin.professional.currentTitle}`,
      `- **Experiência:** ${twin.professional.yearsExp} anos`,
      `- **Localização:** ${twin.identity.location}`,
      `- **Idiomas:** ${twin.identity.languages.join(', ')}`,
      '',
      `## Stack`,
      twin.professional.stack.map(s => `- ${s}`).join('\n'),
      '',
      `## Skills`,
      twin.professional.skills.map(s => `- ${s}`).join('\n'),
      '',
      `## Projetos`,
      ...twin.projects.map(p => `### ${p.name}\n${p.description}\n**Tech:** ${p.tech.join(', ')}`),
      '',
      `## Histórico`,
      ...twin.history.map(h => `### ${h.role} @ ${h.company} (${h.period})\n${h.highlights.join('\n')}`),
    ];
    fs.mkdirSync(WORK_DIR, { recursive: true });
    fs.writeFileSync(hintPath, lines.join('\n'), 'utf-8');
  }
}
