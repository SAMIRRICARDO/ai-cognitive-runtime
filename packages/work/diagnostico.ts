// packages/work/diagnostico.ts
// Uso: npx tsx diagnostico.ts

import fs from 'fs';
import path from 'path';

// Carrega .env manualmente (sem dependência de dotenv)
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
    if (match) process.env[match[1]] ??= match[2].trim();
  }
}

type CheckResult = { ok: boolean; msg: string };
type Check = { name: string; run: () => CheckResult | Promise<CheckResult> };

const checks: Check[] = [];

// ─── 1. Variáveis obrigatórias ───────────────────────────────────────────────

checks.push({
  name: 'Vars obrigatórias (LinkedIn + Anthropic)',
  run: () => {
    const required = ['ANTHROPIC_API_KEY', 'LINKEDIN_EMAIL', 'LINKEDIN_PASSWORD'];
    const missing = required.filter(v => {
      const val = process.env[v];
      return !val || val.includes('...') || val.startsWith('seu') || val.startsWith('sua');
    });
    return missing.length === 0
      ? { ok: true, msg: 'ANTHROPIC_API_KEY, LINKEDIN_EMAIL, LINKEDIN_PASSWORD configuradas' }
      : { ok: false, msg: `Preencha no .env: ${missing.join(', ')}` };
  },
});

checks.push({
  name: 'Vars de paths (vault + currículo)',
  run: () => {
    const vars = ['OBSIDIAN_VAULT', 'RESUME_PATH'];
    const missing = vars.filter(v => !process.env[v] || process.env[v]!.includes('SeuUsuario'));
    return missing.length === 0
      ? { ok: true, msg: 'OBSIDIAN_VAULT e RESUME_PATH configurados' }
      : { ok: false, msg: `Preencha no .env: ${missing.join(', ')}` };
  },
});

checks.push({
  name: 'Vars opcionais (Gupy + dados pessoais)',
  run: () => {
    const optional = ['GUPY_EMAIL', 'GUPY_PASSWORD', 'CANDIDATE_NAME', 'CANDIDATE_PHONE'];
    const missing = optional.filter(v => {
      const val = process.env[v];
      return !val || val.includes('99999') || val.startsWith('seu') || val.startsWith('Seu');
    });
    return missing.length === 0
      ? { ok: true, msg: 'Todas configuradas' }
      : { ok: true, msg: `Não preenchidas (apenas afeta Gupy): ${missing.join(', ')}` };
  },
});

// ─── 2. Arquivo de currículo ─────────────────────────────────────────────────

checks.push({
  name: 'PDF do currículo',
  run: () => {
    const p = process.env.RESUME_PATH ?? '';
    if (!p) return { ok: false, msg: 'RESUME_PATH não definido' };
    if (!fs.existsSync(p)) return { ok: false, msg: `Arquivo não encontrado: ${p}` };
    const size = (fs.statSync(p).size / 1024).toFixed(0);
    return { ok: true, msg: `${p} (${size} KB)` };
  },
});

// ─── 3. Vault Obsidian ───────────────────────────────────────────────────────

checks.push({
  name: 'Vault Obsidian',
  run: () => {
    const v = process.env.OBSIDIAN_VAULT ?? '';
    if (!v) return { ok: false, msg: 'OBSIDIAN_VAULT não definido' };
    if (!fs.existsSync(v)) return { ok: false, msg: `Pasta não encontrada: ${v}` };
    const sub = path.join(v, 'vraxia-work');
    if (!fs.existsSync(sub)) {
      return { ok: false, msg: `Crie a pasta: ${sub}` };
    }
    // Busca recursiva por .md em subpastas
    const findMds = (dir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      return entries.flatMap(e =>
        e.isDirectory() ? findMds(path.join(dir, e.name))
        : e.name.endsWith('.md') ? [path.join(dir, e.name)] : []
      );
    };
    const mds = findMds(sub);
    return { ok: mds.length > 0, msg: `${mds.length} arquivo(s) .md em vraxia-work/ (subpastas incluídas)` };
  },
});

// ─── 4. StatusTracker SQLite ─────────────────────────────────────────────────

checks.push({
  name: 'StatusTracker (SQLite via sql.js)',
  run: async () => {
    try {
      const { StatusTracker } = await import('./src/agents/StatusTracker.js');
      const tracker = await StatusTracker.create();
      const stats = tracker.getStats();
      tracker.close();
      const total = Object.values(stats).reduce((a, b) => a + b, 0);
      return { ok: true, msg: `DB OK — ${total} candidatura(s) no histórico` };
    } catch (err) {
      return { ok: false, msg: `Erro ao inicializar SQLite: ${String(err)}` };
    }
  },
});

// ─── 5. Playwright + playwright-extra ────────────────────────────────────────

checks.push({
  name: 'Playwright instalado',
  run: async () => {
    try {
      await import('playwright-extra');
      return { ok: true, msg: 'playwright-extra OK' };
    } catch {
      return { ok: false, msg: 'Rode: npm install' };
    }
  },
});

checks.push({
  name: 'Stealth plugin',
  run: async () => {
    try {
      await import('puppeteer-extra-plugin-stealth');
      return { ok: true, msg: 'puppeteer-extra-plugin-stealth OK' };
    } catch {
      return { ok: false, msg: 'Rode: npm install puppeteer-extra-plugin-stealth' };
    }
  },
});

// ─── 6. Browsers Playwright instalados ──────────────────────────────────────

checks.push({
  name: 'Chromium (Playwright browser)',
  run: async () => {
    try {
      const { chromium } = await import('playwright-extra');
      const browser = await (chromium as any).launch({ headless: true });
      await browser.close();
      return { ok: true, msg: 'chromium lança OK em headless' };
    } catch (err) {
      const msg = String(err);
      if (msg.includes('Executable') || msg.includes('not found')) {
        return { ok: false, msg: 'Rode: npx playwright install chromium' };
      }
      return { ok: false, msg };
    }
  },
});

// ─── Runner ──────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  VRAXIA WORK — Diagnóstico de Ambiente');
  console.log('══════════════════════════════════════════════\n');

  let failed = 0;

  for (const check of checks) {
    const result = await check.run();
    const icon = result.ok ? '✅' : '❌';
    console.log(`${icon}  ${check.name}`);
    console.log(`     ${result.msg}\n`);
    if (!result.ok) failed++;
  }

  console.log('══════════════════════════════════════════════');
  if (failed === 0) {
    console.log('  Tudo OK — pronto para: npx tsx src/cli/hunt.ts --dry-run');
  } else {
    console.log(`  ${failed} problema(s) encontrado(s) — corrija antes de executar o hunt`);
  }
  console.log('══════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Erro fatal:', err); process.exit(1); });
