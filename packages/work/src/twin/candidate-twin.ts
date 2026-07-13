// packages/work/src/twin/candidate-twin.ts
// Digital Twin persistido em SQLite como JSON blob

import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { CandidateTwin } from '../types/index.js';

const DB_DIR  = path.resolve(process.cwd(), '.vraxia-work');
const DB_PATH = path.join(DB_DIR, 'work.db');

const DEFAULT_TWIN: CandidateTwin = {
  id: 'samir-ricardo',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  identity: {
    name: 'Samir Ricardo Almeida',
    email: process.env.LINKEDIN_EMAIL ?? '',
    phone: process.env.CANDIDATE_PHONE ?? '',
    cpf: '205.377.158-51',
    location: 'São Paulo, SP, Brasil',
    languages: ['Português (nativo)', 'Inglês (intermediário)'],
    linkedin: process.env.LINKEDIN_PROFILE_URL ?? 'https://linkedin.com/in/samir-ricardo-almeida-b23b3825b',
    github: 'https://github.com/SAMIRRICARDO',
  },
  professional: {
    currentTitle: 'AI Architect & Full Stack Developer',
    yearsExp: 15,
    seniority: 'architect',
    skills: [
      'TypeScript', 'Node.js', 'React', 'Python', 'Azure',
      'LLM/IA', 'RAG', 'Multi-Agent', 'Docker', 'PostgreSQL',
    ],
    stack: ['TypeScript', 'Node.js', 'React', 'Python', 'Azure', 'Redis', 'PostgreSQL'],
    industries: ['SaaS', 'FinTech', 'Consultoria', 'Entretenimento'],
  },
  projects: [
    {
      name: 'VRAXIA',
      description: 'Runtime cognitivo multi-agente com RAG semântico e orquestração de LLMs.',
      tech: ['TypeScript', 'Anthropic SDK', 'Redis', 'pgvector'],
      url: 'https://vraxia.com',
      highlights: ['Framework Human RAG', 'Multi-agent orchestration', 'Cost optimization'],
    },
    {
      name: 'VRASHOWS',
      description: 'HUB premium de entretenimento ao vivo com automação de booking e CRM.',
      tech: ['TypeScript', 'Next.js', 'Stripe', 'PostgreSQL'],
      url: 'https://vrashows.com.br',
      highlights: ['B2B enterprise', 'Booking automation', 'Revenue management'],
    },
  ],
  preferences: {
    targetSalary: 14000,
    currency: 'BRL',
    remote: true,
    workTypes: ['CLT', 'PJ'],
    locations: ['São Paulo, SP', 'Remoto'],
    companySizes: ['startup', 'scale-up', 'enterprise'],
  },
  behavioral: {
    strengths: ['Visão arquitetural', 'Autonomia técnica', 'Entrega rápida', 'Liderança técnica'],
    weaknesses: ['Perfeccionismo em detalhes de UI', 'Prefere async a reuniões longas'],
    motivations: ['Impacto real', 'Tecnologia de ponta', 'Autonomia', 'Produto próprio'],
    values: ['Qualidade', 'Transparência', 'Inovação', 'Resultado'],
    workStyle: 'Autônomo, orientado a resultado, comunicação direta, documentação clara.',
  },
  history: [
    {
      company: 'VRAXIA / VRASHOWS',
      role: 'Founder & AI Architect',
      period: '2022–presente',
      highlights: ['Desenvolveu runtime cognitivo multi-agente', 'Integrou LLM em produção', 'Framework Human RAG open-source'],
      tech: ['TypeScript', 'Python', 'Anthropic SDK', 'Azure', 'React'],
    },
  ],
  financial: {
    currentSalary: 0,
    targetSalary: parseInt(process.env.SALARY_EXPECTATION ?? '14000', 10),
    currency: 'BRL',
    negotiable: true,
  },
  learning: {
    certifications: ['Azure AI Engineer (em progresso)'],
    studying: ['Multi-agent systems', 'Vector databases', 'Rust'],
    goals: ['Staff Engineer em empresa de produto', 'Lançar VRAXIA como SaaS'],
    education: [
      {
        institution: 'USP / Univesp',
        degree: 'Graduação',
        course: 'Tecnologia da Informação',
        year: 2025,
      },
    ],
  },
};

export class TwinStore {
  private db!: Database;
  private SQL!: SqlJsStatic;
  private initialized = false;

  static async create(): Promise<TwinStore> {
    const store = new TwinStore();
    await store.init();
    return store;
  }

  private async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(DB_DIR, { recursive: true });
    this.SQL = await initSqlJs();
    if (fs.existsSync(DB_PATH)) {
      this.db = new this.SQL.Database(fs.readFileSync(DB_PATH));
    } else {
      this.db = new this.SQL.Database();
    }
    this.migrate();
    this.initialized = true;
  }

  private save(): void {
    fs.writeFileSync(DB_PATH, Buffer.from(this.db.export()));
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS candidate_twin (
        id      TEXT PRIMARY KEY,
        data    TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.save();
  }

  get(): CandidateTwin {
    try {
      const res = this.db.exec(`SELECT data FROM candidate_twin WHERE id = 'samir-ricardo'`);
      if (!res.length || !res[0].values.length) return { ...DEFAULT_TWIN };
      return JSON.parse(res[0].values[0][0] as string) as CandidateTwin;
    } catch {
      return { ...DEFAULT_TWIN };
    }
  }

  save_twin(twin: CandidateTwin): void {
    const now = new Date().toISOString();
    twin.updatedAt = now;
    this.db.run(`
      INSERT INTO candidate_twin (id, data, created_at, updated_at)
      VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at
    `, [twin.id, JSON.stringify(twin), twin.createdAt, now]);
    this.save();
  }

  patch(partial: Partial<CandidateTwin>): CandidateTwin {
    const current = this.get();
    const updated = deepMerge(current as unknown as Record<string, unknown>, partial as unknown as Record<string, unknown>) as unknown as CandidateTwin;
    this.save_twin(updated);
    return updated;
  }

  close(): void {
    this.save();
    this.db.close();
  }
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv)) {
      out[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else if (sv !== undefined) {
      out[key] = sv;
    }
  }
  return out;
}
