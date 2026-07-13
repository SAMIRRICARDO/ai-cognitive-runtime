// packages/work/src/marketplace/registry.ts
// Catálogo + instalação + execução de plugins do marketplace

import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { AgentPlugin, AgentContext, AgentResult, PluginCategory, CATEGORY_LABEL } from './plugin-interface.js';
import { startupRadar }      from './plugins/startup-radar.js';
import { coverLetter }       from './plugins/cover-letter.js';
import { equityCalculator }  from './plugins/equity-calculator.js';
import { linkedinOptimizer } from './plugins/linkedin-optimizer.js';
import { headhunterScript }  from './plugins/headhunter-script.js';
import { visaFilter }        from './plugins/visa-filter.js';

const DB_DIR  = path.resolve(process.cwd(), '.vraxia-work');
const DB_PATH = path.join(DB_DIR, 'work.db');

// Catálogo canônico — todos os plugins disponíveis
const CATALOG: AgentPlugin[] = [
  startupRadar,
  coverLetter,
  equityCalculator,
  linkedinOptimizer,
  headhunterScript,
  visaFilter,
];

export interface MarketplaceEntry {
  id: string;
  name: string;
  description: string;
  longDescription: string;
  version: string;
  author: string;
  category: PluginCategory;
  categoryLabel: string;
  intents: string[];
  price: 'free' | number;
  iconEmoji: string;
  tags: string[];
  installed: boolean;
  enabled: boolean;
  installedAt: string | null;
}

function row2obj(res: ReturnType<Database['exec']>): Record<string, unknown>[] {
  if (!res.length) return [];
  return res[0].values.map(row =>
    Object.fromEntries(res[0].columns.map((c, i) => [c, row[i]])),
  );
}

export class AgentRegistry {
  private db!: Database;
  private SQL!: SqlJsStatic;
  private installedIds = new Set<string>();

  static async create(): Promise<AgentRegistry> {
    const r = new AgentRegistry();
    await r.init();
    return r;
  }

  private async init(): Promise<void> {
    fs.mkdirSync(DB_DIR, { recursive: true });
    this.SQL = await initSqlJs();
    this.db  = fs.existsSync(DB_PATH)
      ? new this.SQL.Database(fs.readFileSync(DB_PATH))
      : new this.SQL.Database();
    this.migrate();
    this.loadInstalled();
  }

  private save(): void {
    fs.writeFileSync(DB_PATH, Buffer.from(this.db.export()));
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS marketplace_plugins (
        id           TEXT PRIMARY KEY,
        installed_at TEXT NOT NULL,
        enabled      INTEGER DEFAULT 1,
        config       TEXT DEFAULT '{}'
      )
    `);
    this.save();
  }

  private loadInstalled(): void {
    const rows = row2obj(this.db.exec(`SELECT id FROM marketplace_plugins WHERE enabled = 1`));
    this.installedIds = new Set(rows.map(r => r['id'] as string));
  }

  // ── Catalog ───────────────────────────────────────────────────────────────

  getCatalog(): MarketplaceEntry[] {
    const installedRows = row2obj(this.db.exec(`SELECT id, installed_at, enabled FROM marketplace_plugins`));
    const installedMap = new Map(installedRows.map(r => [r['id'] as string, r]));

    return CATALOG.map(p => {
      const row = installedMap.get(p.id);
      return {
        id:            p.id,
        name:          p.name,
        description:   p.description,
        longDescription: p.longDescription,
        version:       p.version,
        author:        p.author,
        category:      p.category,
        categoryLabel: CATEGORY_LABEL[p.category],
        intents:       p.intents,
        price:         p.price,
        iconEmoji:     p.iconEmoji,
        tags:          p.tags,
        installed:     !!row,
        enabled:       row ? !!(row['enabled'] as number) : false,
        installedAt:   row ? (row['installed_at'] as string) : null,
      };
    });
  }

  getInstalled(): AgentPlugin[] {
    return CATALOG.filter(p => this.installedIds.has(p.id));
  }

  isInstalled(id: string): boolean {
    return this.installedIds.has(id);
  }

  // ── Install / Uninstall ───────────────────────────────────────────────────

  install(pluginId: string): void {
    if (!CATALOG.find(p => p.id === pluginId)) throw new Error(`Plugin "${pluginId}" não encontrado no catálogo`);
    const now = new Date().toISOString();
    this.db.run(`
      INSERT INTO marketplace_plugins (id, installed_at, enabled)
      VALUES (?,?,1)
      ON CONFLICT(id) DO UPDATE SET enabled = 1, installed_at = excluded.installed_at
    `, [pluginId, now]);
    this.installedIds.add(pluginId);
    this.save();
  }

  uninstall(pluginId: string): void {
    this.db.run(`DELETE FROM marketplace_plugins WHERE id = ?`, [pluginId]);
    this.installedIds.delete(pluginId);
    this.save();
  }

  toggle(pluginId: string, enabled: boolean): void {
    this.db.run(`UPDATE marketplace_plugins SET enabled = ? WHERE id = ?`, [enabled ? 1 : 0, pluginId]);
    if (enabled) this.installedIds.add(pluginId);
    else this.installedIds.delete(pluginId);
    this.save();
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  // Executa TODOS os plugins instalados que atendem ao intent
  async executeForIntent(intent: string, context: AgentContext): Promise<AgentResult[]> {
    const eligible = CATALOG.filter(p =>
      this.installedIds.has(p.id) && p.intents.includes(intent),
    );
    const results = await Promise.allSettled(eligible.map(p => p.execute(context)));
    return results
      .filter((r): r is PromiseFulfilledResult<AgentResult> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  // Executa um plugin específico (chamada direta do dashboard)
  async executePlugin(pluginId: string, context: AgentContext): Promise<AgentResult> {
    const plugin = CATALOG.find(p => p.id === pluginId);
    if (!plugin) throw new Error(`Plugin "${pluginId}" não encontrado`);
    return plugin.execute(context);
  }

  close(): void {
    this.save();
    this.db.close();
  }
}
