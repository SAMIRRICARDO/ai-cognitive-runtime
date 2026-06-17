import fs from 'fs';
import path from 'path';

// Estados do PDF — ciclo de vida completo de um lead LinkedIn
export type LeadState =
  | 'COLLECTED'
  | 'PROFILE_ANALYZED'
  | 'DIRECT_MESSAGE_AVAILABLE'
  | 'CONNECTION_REQUIRED'
  | 'INVITATION_SENT'
  | 'WAITING_ACCEPTANCE'
  | 'CONNECTED'
  | 'MESSAGE_SENT'
  | 'FOLLOWUP_PENDING'
  | 'CLOSED';

export interface LeadStateRecord {
  linkedin_url: string;
  name: string;
  company: string;
  state: LeadState;
  previousState?: LeadState;
  transitionAt: string;
  transitionReason: string;
  attemptCount: number;
  inviteSentAt?: string;
  messageSentAt?: string;
  followupDue?: string;
  lastError?: string;
}

// Estados que não devem ser reprocessados na sessão corrente
const SKIP_STATES: LeadState[] = [
  'MESSAGE_SENT',
  'INVITATION_SENT',
  'WAITING_ACCEPTANCE',
  'CLOSED',
];

export class LeadStateMachine {
  private records: Map<string, LeadStateRecord> = new Map();

  constructor(private readonly filePath: string) {}

  load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const list: LeadStateRecord[] = JSON.parse(raw);
      for (const r of list) this.records.set(r.linkedin_url, r);
    } catch { /* arquivo não existe ainda — começa vazio */ }
  }

  persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(
      this.filePath,
      JSON.stringify(Array.from(this.records.values()), null, 2),
      'utf-8'
    );
  }

  getState(url: string): LeadState {
    return this.records.get(url)?.state ?? 'COLLECTED';
  }

  getRecord(url: string): LeadStateRecord | undefined {
    return this.records.get(url);
  }

  shouldSkip(url: string): boolean {
    return SKIP_STATES.includes(this.getState(url));
  }

  transition(
    url: string,
    to: LeadState,
    reason: string,
    meta: Partial<Pick<
      LeadStateRecord,
      'name' | 'company' | 'inviteSentAt' | 'messageSentAt' | 'followupDue' | 'lastError'
    >> = {}
  ): void {
    const current = this.records.get(url);
    const now = new Date().toISOString();
    const record: LeadStateRecord = {
      linkedin_url: url,
      name: meta.name ?? current?.name ?? '',
      company: meta.company ?? current?.company ?? '',
      ...current,
      ...meta,
      state: to,
      previousState: current?.state,
      transitionAt: now,
      transitionReason: reason,
      attemptCount: (current?.attemptCount ?? 0) + 1,
    };
    this.records.set(url, record);
  }

  // Seed a partir de log de DMs existente (migração de estado sem SM)
  seedFromDmLog(entries: Array<{ linkedin_url: string; name: string; company: string; status: string; sent_at: string }>): void {
    for (const e of entries) {
      if (this.records.has(e.linkedin_url)) continue; // SM já conhece este lead
      if (e.status === 'sent') {
        this.records.set(e.linkedin_url, {
          linkedin_url: e.linkedin_url,
          name: e.name,
          company: e.company,
          state: 'MESSAGE_SENT',
          transitionAt: e.sent_at,
          transitionReason: 'seeded_from_dm_log',
          attemptCount: 1,
          messageSentAt: e.sent_at,
        });
      } else if (e.status === 'skipped') {
        this.records.set(e.linkedin_url, {
          linkedin_url: e.linkedin_url,
          name: e.name,
          company: e.company,
          state: 'CLOSED',
          transitionAt: e.sent_at,
          transitionReason: 'seeded_from_dm_log_skipped',
          attemptCount: 1,
        });
      }
    }
  }

  // Convites enviados há mais de N dias sem aceite
  getStaleInvites(days = 7): LeadStateRecord[] {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    return Array.from(this.records.values()).filter(r =>
      r.state === 'INVITATION_SENT' &&
      r.inviteSentAt &&
      new Date(r.inviteSentAt) < cutoff
    );
  }

  // Leads prontos para follow-up
  getDueForFollowup(): LeadStateRecord[] {
    const now = new Date();
    return Array.from(this.records.values()).filter(r =>
      r.state === 'FOLLOWUP_PENDING' &&
      r.followupDue &&
      new Date(r.followupDue) <= now
    );
  }

  summary(): Record<LeadState, number> {
    const counts = {} as Record<LeadState, number>;
    for (const r of this.records.values()) {
      counts[r.state] = (counts[r.state] ?? 0) + 1;
    }
    return counts;
  }
}
