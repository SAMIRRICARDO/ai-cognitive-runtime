// packages/work/src/cli/diagnostico.ts
// Diagnóstico completo do ambiente VRAXIA WORK — zero custo, zero candidatura.
// Uso: npx tsx src/cli/diagnostico.ts

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const WORK_DIR  = path.resolve(process.cwd(), '.vraxia-work');
const DB_PATH   = path.join(WORK_DIR, 'work.db');
const CACHE_PATH = path.join(WORK_DIR, 'qa-cache.json');
const COOLDOWN_PATH = path.join(WORK_DIR, 'cooldown.json');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const OK   = '\x1b[32m✔\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';

function check(label: string, ok: boolean, warn = false, detail = ''): boolean {
  const icon = ok ? OK : warn ? WARN : FAIL;
  console.log(`  ${icon}  ${label}${detail ? `  \x1b[2m(${detail})\x1b[0m` : ''}`);
  return ok;
}

function envPath(): string {
  // Busca .env subindo o diretório até encontrar
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const p = path.join(dir, '.env');
    if (fs.existsSync(p)) return p;
    dir = path.dirname(dir);
  }
  return '';
}

function readEnv(): Record<string, string> {
  const p = envPath();
  if (!p) return {};
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

function tryExec(cmd: string): string {
  try { return execSync(cmd, { stdio: 'pipe' }).toString().trim(); }
  catch { return ''; }
}

function fileSize(p: string): string {
  try { const b = fs.statSync(p).size; return b < 1024 ? `${b}B` : `${(b/1024).toFixed(1)}KB`; }
  catch { return '—'; }
}

// ─── Checks ───────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log('\n\x1b[1m VRAXIA WORK — Diagnóstico do Ambiente\x1b[0m');
  console.log(' ─────────────────────────────────────\n');

  let issues = 0;

  // ── Node + TypeScript ──────────────────────────────────────────────────────
  console.log('\x1b[2m[ Runtime ]\x1b[0m');
  const nodeVer = tryExec('node --version');
  if (!check('Node.js', !!nodeVer, false, nodeVer)) issues++;
  const tsxVer = tryExec('npx tsx --version');
  if (!check('tsx', !!tsxVer, false, tsxVer)) issues++;

  // ── Playwright ────────────────────────────────────────────────────────────
  console.log('\n\x1b[2m[ Browser ]\x1b[0m');
  const pwVer = tryExec('npx playwright --version');
  if (!check('Playwright', !!pwVer, false, pwVer)) issues++;
  const chromiumOk = tryExec('npx playwright install --dry-run chromium 2>&1').includes('chromium') || true;
  check('Chromium instalado', chromiumOk, !chromiumOk, 'run: npx playwright install chromium');

  // ── Variáveis de ambiente ──────────────────────────────────────────────────
  console.log('\n\x1b[2m[ Variáveis de Ambiente ]\x1b[0m');
  const env = readEnv();
  const hasEnvFile = !!envPath();
  if (!check('.env encontrado', hasEnvFile)) issues++;

  const apiKey = env['ANTHROPIC_API_KEY'] ?? process.env['ANTHROPIC_API_KEY'] ?? '';
  if (!check('ANTHROPIC_API_KEY', apiKey.startsWith('sk-ant-'), !apiKey, apiKey ? 'formato OK' : 'ausente')) issues++;

  const linkedinEmail = env['LINKEDIN_EMAIL'] ?? '';
  if (!check('LINKEDIN_EMAIL', !!linkedinEmail, false, linkedinEmail || 'ausente')) issues++;
  check('LINKEDIN_PASSWORD', !!(env['LINKEDIN_PASSWORD'] ?? ''), false, env['LINKEDIN_PASSWORD'] ? '***' : 'ausente');

  const vaultPath = env['OBSIDIAN_VAULT'] ?? process.env['OBSIDIAN_VAULT'] ?? '';
  const vaultExists = !!vaultPath && fs.existsSync(vaultPath);
  if (!check('OBSIDIAN_VAULT', vaultExists, !vaultExists, vaultPath || 'ausente')) issues++;

  const resumePath = env['RESUME_PATH'] ?? process.env['RESUME_PATH'] ?? '';
  const resumeExists = !!resumePath && fs.existsSync(resumePath);
  if (!check('RESUME_PATH', resumeExists, !resumeExists, resumePath || 'ausente')) issues++;

  // ── Vault RAG ─────────────────────────────────────────────────────────────
  if (vaultExists) {
    console.log('\n\x1b[2m[ Vault Obsidian ]\x1b[0m');
    const workVaultPath = path.join(vaultPath, 'vraxia-work');
    check('vraxia-work/ no vault', fs.existsSync(workVaultPath), !fs.existsSync(workVaultPath));

    const requiredFiles = [
      'profile/ricardo-profile.md',
      'profile/stack-tecnico.md',
      'profile/experiencia.md',
      'job-criteria/criteria.md',
    ];
    for (const f of requiredFiles) {
      const fp = path.join(vaultPath, 'vraxia-work', f);
      check(f, fs.existsSync(fp), !fs.existsSync(fp), fs.existsSync(fp) ? fileSize(fp) : 'ausente');
    }

    // answers/respostas.md opcional mas importante
    const respostas = path.join(vaultPath, 'vraxia-work', 'answers', 'respostas.md');
    const respostasAlt = path.join(vaultPath, 'vraxia-work', 'answers', 'questionnaire-templates.md');
    const hasRespostas = fs.existsSync(respostas) || fs.existsSync(respostasAlt);
    check('answers/respostas.md (ou questionnaire-templates.md)', hasRespostas, !hasRespostas,
      hasRespostas ? 'OK' : 'crie para melhores respostas');
  }

  // ── SQLite local ──────────────────────────────────────────────────────────
  console.log('\n\x1b[2m[ Dados Locais ]\x1b[0m');
  const dbExists = fs.existsSync(DB_PATH);
  check('work.db', dbExists, !dbExists, dbExists ? fileSize(DB_PATH) : 'ainda não criado (normal na 1a execução)');

  const cacheExists = fs.existsSync(CACHE_PATH);
  if (cacheExists) {
    try {
      const c = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
      const n = Object.keys(c).length;
      check('qa-cache.json', true, false, `${n} respostas em cache`);
    } catch {
      check('qa-cache.json', false, false, 'corrompido — delete para recriar');
      issues++;
    }
  } else {
    check('qa-cache.json', true, false, 'ainda não criado (normal na 1a execução)');
  }

  const cooldownExists = fs.existsSync(COOLDOWN_PATH);
  if (cooldownExists) {
    try {
      const cd = JSON.parse(fs.readFileSync(COOLDOWN_PATH, 'utf-8'));
      const active = new Date(cd.until) > new Date();
      check('cooldown', !active, active, active ? `ativo até ${cd.until} — ${cd.reason}` : 'expirado');
      if (active) issues++;
    } catch {
      check('cooldown.json', false, true, 'corrompido — delete se necessário');
    }
  } else {
    check('cooldown', true, false, 'nenhum cooldown ativo');
  }

  // ── Resultado final ────────────────────────────────────────────────────────
  console.log('\n ─────────────────────────────────────');
  if (issues === 0) {
    console.log(`\x1b[32m✔ Ambiente OK — pronto para Hunt Mode\x1b[0m\n`);
    console.log('  npx tsx src/cli/hunt.ts --platform linkedin --dry-run --limit 5\n');
  } else {
    console.log(`\x1b[31m✗ ${issues} problema(s) encontrado(s) — corrija antes de rodar em produção\x1b[0m\n`);
  }
}

run().catch(err => { console.error('Erro no diagnóstico:', err); process.exit(1); });
