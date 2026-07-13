// packages/work/src/agents/NetworkingAgent.ts
// CRM de recrutadores + geração de mensagens de conexão (Haiku)

import Anthropic from '@anthropic-ai/sdk';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { RecruiterContact, RecruiterInteraction } from '../types/index.js';
import { TwinStore } from '../twin/candidate-twin.js';

const DB_DIR  = path.resolve(process.cwd(), '.vraxia-work');
const DB_PATH = path.join(DB_DIR, 'work.db');

function row2obj(res: ReturnType<Database['exec']>): Record<string, unknown>[] {
  if (!res.length) return [];
  return res[0].values.map(row =>
    Object.fromEntries(res[0].columns.map((c, i) => [c, row[i]])),
  );
}

export class NetworkingAgent {
  private client: Anthropic;
  private db!: Database;
  private SQL!: SqlJsStatic;

  constructor(
    private twinStore: TwinStore,
    apiKey?: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  static async create(twinStore: TwinStore, apiKey?: string): Promise<NetworkingAgent> {
    const agent = new NetworkingAgent(twinStore, apiKey);
    await agent.init();
    return agent;
  }

  private async init(): Promise<void> {
    fs.mkdirSync(DB_DIR, { recursive: true });
    this.SQL = await initSqlJs();
    this.db  = fs.existsSync(DB_PATH)
      ? new this.SQL.Database(fs.readFileSync(DB_PATH))
      : new this.SQL.Database();
    this.migrate();
  }

  private save(): void {
    fs.writeFileSync(DB_PATH, Buffer.from(this.db.export()));
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS recruiter_crm (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        company      TEXT DEFAULT '',
        linkedin_url TEXT DEFAULT '',
        email        TEXT DEFAULT '',
        role         TEXT DEFAULT '',
        last_contact TEXT DEFAULT '',
        status       TEXT DEFAULT 'ativo',
        notes        TEXT DEFAULT '',
        interactions TEXT DEFAULT '[]',
        created_at   TEXT NOT NULL
      )
    `);
    this.save();
  }

  // ── CRM CRUD ──────────────────────────────────────────────────────────────

  addRecruiter(contact: Omit<RecruiterContact, 'id' | 'createdAt'>): RecruiterContact {
    const id  = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const full: RecruiterContact = { ...contact, id, createdAt: now };
    this.db.run(`
      INSERT INTO recruiter_crm (id, name, company, linkedin_url, email, role, last_contact, status, notes, interactions, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `, [id, full.name, full.company, full.linkedinUrl, full.email, full.role,
        full.lastContact, full.status, full.notes, JSON.stringify(full.interactions), now]);
    this.save();
    return full;
  }

  getRecruiters(status?: string): RecruiterContact[] {
    const rows = status
      ? row2obj(this.db.exec(`SELECT * FROM recruiter_crm WHERE status = ? ORDER BY last_contact DESC`, [status]))
      : row2obj(this.db.exec(`SELECT * FROM recruiter_crm ORDER BY last_contact DESC`));
    return rows.map(this.rowToContact);
  }

  updateRecruiter(id: string, updates: Partial<RecruiterContact>): void {
    if (updates.status)      this.db.run(`UPDATE recruiter_crm SET status = ? WHERE id = ?`, [updates.status, id]);
    if (updates.notes)       this.db.run(`UPDATE recruiter_crm SET notes = ? WHERE id = ?`, [updates.notes, id]);
    if (updates.lastContact) this.db.run(`UPDATE recruiter_crm SET last_contact = ? WHERE id = ?`, [updates.lastContact, id]);
    if (updates.interactions) this.db.run(`UPDATE recruiter_crm SET interactions = ? WHERE id = ?`, [JSON.stringify(updates.interactions), id]);
    this.save();
  }

  addInteraction(id: string, interaction: RecruiterInteraction): void {
    const rows = row2obj(this.db.exec(`SELECT interactions FROM recruiter_crm WHERE id = ?`, [id]));
    if (!rows.length) return;
    const existing = JSON.parse((rows[0]['interactions'] as string) || '[]') as RecruiterInteraction[];
    existing.push(interaction);
    this.db.run(`UPDATE recruiter_crm SET interactions = ?, last_contact = ? WHERE id = ?`,
      [JSON.stringify(existing), interaction.date, id]);
    this.save();
  }

  private rowToContact(r: Record<string, unknown>): RecruiterContact {
    return {
      id:           r['id'] as string,
      name:         r['name'] as string,
      company:      r['company'] as string,
      linkedinUrl:  r['linkedin_url'] as string,
      email:        r['email'] as string,
      role:         r['role'] as string,
      lastContact:  r['last_contact'] as string,
      status:       r['status'] as RecruiterContact['status'],
      notes:        r['notes'] as string,
      interactions: JSON.parse((r['interactions'] as string) || '[]') as RecruiterInteraction[],
      createdAt:    r['created_at'] as string,
    };
  }

  // ── Mensagens ─────────────────────────────────────────────────────────────

  async generateConnectionMessage(
    recruiterName: string,
    company: string,
    jobTitle: string,
  ): Promise<string> {
    const twin = this.twinStore.get();

    const prompt = `Você escreve mensagens de conexão no LinkedIn para candidatos de tecnologia.
Crie uma mensagem de conexão concisa, profissional e personalizada. Máximo 280 caracteres.

CANDIDATO: ${twin.identity.name} — ${twin.professional.currentTitle} com ${twin.professional.yearsExp} anos
STACK: ${twin.professional.stack.slice(0, 5).join(', ')}
RECRUTADOR: ${recruiterName} @ ${company}
VAGA: ${jobTitle}

Retorne APENAS a mensagem, sem aspas ou formatação extra.`;

    try {
      const r = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      });
      const msg = r.content[0].type === 'text' ? r.content[0].text.trim() : '';
      return msg.slice(0, 280);
    } catch {
      return `Olá ${recruiterName}, sou ${twin.identity.name}, ${twin.professional.currentTitle} com ${twin.professional.yearsExp} anos de experiência. Vi a vaga de ${jobTitle} na ${company} e gostaria de conectar!`;
    }
  }

  async generateFollowUp(recruiter: RecruiterContact, daysSinceContact: number): Promise<string> {
    const twin = this.twinStore.get();

    const prompt = `Crie um follow-up para um candidato que não recebeu resposta de um recrutador.
Tom: profissional, não insistente, breve. Máximo 300 caracteres.

CANDIDATO: ${twin.identity.name} — ${twin.professional.currentTitle}
RECRUTADOR: ${recruiter.name} @ ${recruiter.company}
DIAS SEM RESPOSTA: ${daysSinceContact}
HISTÓRICO: ${recruiter.interactions.slice(-1)[0]?.message?.slice(0, 100) ?? 'Primeiro contato'}

Retorne APENAS a mensagem.`;

    try {
      const r = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      });
      return r.content[0].type === 'text' ? r.content[0].text.trim().slice(0, 300) : '';
    } catch {
      return `Olá ${recruiter.name}, estou fazendo um follow-up sobre minha candidatura na ${recruiter.company}. Continuo muito interessado! Podemos conversar?`;
    }
  }

  close(): void {
    this.save();
    this.db.close();
  }
}
