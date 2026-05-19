#!/usr/bin/env tsx
/**
 * restore-runtime.ts — AI Cognitive Runtime restore system
 *
 * Usage:
 *   tsx scripts/restore-runtime.ts --list
 *   tsx scripts/restore-runtime.ts --backup <backup-id-or-path> [--skip-db] [--dry-run] [--force]
 *
 * Examples:
 *   tsx scripts/restore-runtime.ts --list
 *   tsx scripts/restore-runtime.ts --backup backup-2026-05-19-08-00-00
 *   tsx scripts/restore-runtime.ts --backup ./backups/snapshots/pre-v2-deploy-... --force
 */
import { execSync } from "child_process";
import {
  existsSync, readdirSync, readFileSync, writeFileSync,
  cpSync, mkdirSync, statSync,
} from "fs";
import { join, resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";
import * as readline from "readline";

// ─── Setup ────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = resolve(__dirname, "..");
const BACKUPS    = join(ROOT, "backups");

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const flag    = (f: string) => args.includes(f);
const flagVal = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };

const LIST    = flag("--list");
const BACKUP  = flagVal("--backup");
const DRY_RUN = flag("--dry-run");
const SKIP_DB = flag("--skip-db");
const FORCE   = flag("--force");

// ─── Colors ───────────────────────────────────────────────────────────────────

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  ok:   (s: string) => USE_COLOR ? `\x1b[32m✓\x1b[0m ${s}` : `✓ ${s}`,
  fail: (s: string) => USE_COLOR ? `\x1b[31m✗\x1b[0m ${s}` : `✗ ${s}`,
  skip: (s: string) => USE_COLOR ? `\x1b[33m⊘\x1b[0m ${s}` : `⊘ ${s}`,
  info: (s: string) => USE_COLOR ? `\x1b[36m→\x1b[0m ${s}` : `→ ${s}`,
  warn: (s: string) => USE_COLOR ? `\x1b[33m⚠\x1b[0m ${s}` : `⚠ ${s}`,
  bold: (s: string) => USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s,
  dim:  (s: string) => USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s,
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface BackupManifest {
  id: string;
  type: string;
  label?: string;
  timestamp: string;
  git: { branch: string; commit: string; tag: string | null; dirty: boolean };
  env: Record<string, string>;
  components: Record<string, { status: string; detail?: string }>;
  checksums: Record<string, string>;
  totalSizeBytes: number;
  durationMs: number;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const DOCKER_PATHS = [
  "docker",
  "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
  "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker",
];
function resolveDocker(): string {
  for (const bin of DOCKER_PATHS) {
    try { execSync(`"${bin}" --version`, { stdio: "pipe", timeout: 5_000 }); return bin; } catch { /* try next */ }
  }
  return "docker";
}
const DOCKER = resolveDocker();

function exec(cmd: string, opts?: { cwd?: string }): string {
  const resolved = cmd.replace(/^docker\b/, `"${DOCKER}"`);
  return execSync(resolved, { stdio: "pipe", timeout: 120_000, cwd: opts?.cwd ?? ROOT }).toString();
}

function loadManifest(manifestPath: string): BackupManifest | null {
  try { return JSON.parse(readFileSync(manifestPath, "utf8")) as BackupManifest; }
  catch { return null; }
}

function findAllManifests(): Array<{ path: string; manifest: BackupManifest }> {
  const manifestsDir = join(BACKUPS, "manifests");
  if (!existsSync(manifestsDir)) return [];

  return readdirSync(manifestsDir)
    .filter(f => f.endsWith(".json"))
    .map(f => join(manifestsDir, f))
    .map(p => ({ path: p, manifest: loadManifest(p)! }))
    .filter(x => x.manifest)
    .sort((a, b) =>
      new Date(b.manifest.timestamp).getTime() - new Date(a.manifest.timestamp).getTime()
    );
}

function resolveBackupDir(idOrPath: string): { dir: string; manifest: BackupManifest } | null {
  // If it's an absolute or relative path
  const direct = resolve(idOrPath);
  if (existsSync(direct)) {
    const mPath = join(direct, "manifest.json");
    const m = loadManifest(mPath);
    if (m) return { dir: direct, manifest: m };
  }

  // Search manifests by ID
  const all = findAllManifests();
  for (const { manifest } of all) {
    if (manifest.id === idOrPath) {
      // Find the actual backup directory
      const typeDir = join(BACKUPS, manifest.type, manifest.id);
      if (existsSync(typeDir)) return { dir: typeDir, manifest };
    }
  }

  return null;
}

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => {
    rl.question(`${question} [y/N] `, ans => {
      rl.close();
      res(ans.toLowerCase() === "y" || ans.toLowerCase() === "yes");
    });
  });
}

function copyDir(src: string, dest: string): number {
  if (!existsSync(src)) return 0;
  mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) { count += copyDir(s, d); }
    else { cpSync(s, d); count++; }
  }
  return count;
}

// ─── List command ─────────────────────────────────────────────────────────────

function listBackups(): void {
  const all = findAllManifests();

  console.log(`\n${c.bold("Available Backups")}\n`);

  if (all.length === 0) {
    console.log(c.dim("  No backups found. Run: tsx scripts/backup-runtime.ts"));
    return;
  }

  const W = { id: 40, type: 10, commit: 12, ts: 22, size: 8 };
  const hr = `${"─".repeat(W.id)} ${"─".repeat(W.type)} ${"─".repeat(W.commit)} ${"─".repeat(W.ts)} ${"─".repeat(W.size)}`;

  console.log(c.dim(`  ${"ID".padEnd(W.id)} ${"Type".padEnd(W.type)} ${"Git".padEnd(W.commit)} ${"Date".padEnd(W.ts)} ${"Size".padEnd(W.size)}`));
  console.log(c.dim(`  ${hr}`));

  for (const { manifest: m } of all) {
    const date = new Date(m.timestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const size = m.totalSizeBytes > 0 ? `${(m.totalSizeBytes / (1024 * 1024)).toFixed(1)} MB` : "—";
    const id   = m.id.length > W.id ? m.id.slice(0, W.id - 1) + "…" : m.id;
    const pg   = m.components?.postgres?.status === "ok" ? "pg✓" : "pg–";
    const red  = m.components?.redis?.status === "ok" ? " rd✓" : " rd–";
    console.log(`  ${id.padEnd(W.id)} ${m.type.padEnd(W.type)} ${m.git.commit.padEnd(W.commit)} ${date.padEnd(W.ts)} ${size.padEnd(W.size)} ${c.dim(pg + red)}`);
  }

  console.log();
  console.log(c.dim("  Restore: tsx scripts/restore-runtime.ts --backup <ID>"));
  console.log();
}

// ─── Restore command ──────────────────────────────────────────────────────────

async function restoreBackup(idOrPath: string): Promise<void> {
  const found = resolveBackupDir(idOrPath);
  if (!found) {
    console.error(c.fail(`Backup not found: ${idOrPath}`));
    console.log(c.dim("  Run --list to see available backups."));
    process.exit(1);
  }

  const { dir: backupDir, manifest: m } = found;

  console.log(`\n${c.bold("AI Cognitive Runtime — Restore")}\n`);
  console.log(c.info(`Backup:    ${m.id}`));
  console.log(c.info(`Type:      ${m.type}`));
  console.log(c.info(`Date:      ${new Date(m.timestamp).toLocaleString("pt-BR")}`));
  console.log(c.info(`Git:       ${m.git.commit} (${m.git.branch})`));
  console.log(c.info(`Size:      ${(m.totalSizeBytes / (1024 * 1024)).toFixed(2)} MB`));
  console.log(c.info(`Postgres:  ${m.components?.postgres?.status ?? "unknown"}`));
  console.log(c.info(`Redis:     ${m.components?.redis?.status ?? "unknown"}`));

  if (DRY_RUN) {
    console.log(`\n${c.bold("[DRY RUN — no changes will be made]")}\n`);
  }

  console.log(`\n${c.warn("WARNING: This will overwrite current source code and databases.")}`);

  if (!FORCE && !DRY_RUN) {
    const ok = await confirm(`\n  Proceed with restore of ${c.bold(m.id)}?`);
    if (!ok) { console.log("\n  Restore cancelled.\n"); process.exit(0); }
  }

  console.log();
  const startMs = Date.now();

  // ── Step 1: Restore code files ─────────────────────────────────────────────
  process.stdout.write(c.info("Restoring source code... "));
  const codeDir = join(backupDir, "code");
  if (existsSync(codeDir)) {
    if (!DRY_RUN) {
      let count = 0;
      for (const entry of readdirSync(codeDir, { withFileTypes: true })) {
        // Skip package-lock.json and node_modules — will be rebuilt
        if (entry.name === "node_modules") continue;
        const s = join(codeDir, entry.name);
        const d = join(ROOT, entry.name);
        if (entry.isDirectory()) { count += copyDir(s, d); }
        else { cpSync(s, d); count++; }
      }
      console.log(c.ok(`${count} files restored`));
    } else { console.log(c.ok("(dry-run)")); }
  } else {
    console.log(c.skip("code backup not found in this backup"));
  }

  // ── Step 2: npm install ────────────────────────────────────────────────────
  process.stdout.write(c.info("Installing dependencies (npm install)... "));
  if (!DRY_RUN) {
    try {
      exec("npm install --prefer-offline", { cwd: ROOT });
      console.log(c.ok("done"));
    } catch {
      exec("npm install", { cwd: ROOT });
      console.log(c.ok("done (online)"));
    }
  } else { console.log(c.ok("(dry-run)")); }

  // ── Step 3: Start infrastructure ───────────────────────────────────────────
  process.stdout.write(c.info("Starting infrastructure (Docker)... "));
  if (!DRY_RUN) {
    try {
      exec("docker compose up -d", { cwd: ROOT });
      // Wait for healthchecks
      await new Promise<void>(r => setTimeout(r, 5000));
      console.log(c.ok("Redis + PostgreSQL up"));
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      console.log(c.skip(`skipped — ${msg.slice(0, 80)}`));
    }
  } else { console.log(c.ok("(dry-run)")); }

  // ── Step 4: Restore PostgreSQL ─────────────────────────────────────────────
  process.stdout.write(c.info("Restoring PostgreSQL... "));
  const pgDump = join(backupDir, "postgres", "ai_lab.sql");
  if (SKIP_DB || m.components?.postgres?.status !== "ok" || !existsSync(pgDump)) {
    console.log(c.skip(SKIP_DB ? "--skip-db" : "no pg backup available"));
  } else if (!DRY_RUN) {
    try {
      // Drop + recreate DB
      exec("docker exec ai-lab-postgres psql -U ailab -c \"DROP DATABASE IF EXISTS ai_lab\"");
      exec("docker exec ai-lab-postgres psql -U ailab -c \"CREATE DATABASE ai_lab\"");
      // Restore from dump (pipe the file through docker exec)
      const dumpContent = readFileSync(pgDump, "utf8");
      const tmpPath = join(ROOT, ".pg_restore_tmp.sql");
      writeFileSync(tmpPath, dumpContent);
      exec(`docker cp "${tmpPath}" ai-lab-postgres:/tmp/restore.sql`);
      exec("docker exec ai-lab-postgres psql -U ailab -d ai_lab -f /tmp/restore.sql");
      exec("docker exec ai-lab-postgres psql -U ailab -c \"rm /tmp/restore.sql\" 2>/dev/null || true");
      const { rmSync } = await import("fs");
      rmSync(tmpPath, { force: true });
      console.log(c.ok("database restored"));
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      console.log(c.fail(`failed — ${msg.slice(0, 80)}`));
    }
  } else { console.log(c.ok("(dry-run)")); }

  // ── Step 5: Restore Redis ──────────────────────────────────────────────────
  process.stdout.write(c.info("Restoring Redis... "));
  const rdb = join(backupDir, "redis", "dump.rdb");
  if (SKIP_DB || m.components?.redis?.status !== "ok" || !existsSync(rdb)) {
    console.log(c.skip(SKIP_DB ? "--skip-db" : "no Redis backup available"));
  } else if (!DRY_RUN) {
    try {
      exec("docker exec ai-lab-redis redis-cli SHUTDOWN NOSAVE 2>/dev/null || true");
      await new Promise<void>(r => setTimeout(r, 1000));
      exec(`docker cp "${rdb}" ai-lab-redis:/data/dump.rdb`);
      exec("docker compose start redis", { cwd: ROOT });
      await new Promise<void>(r => setTimeout(r, 2000));
      console.log(c.ok("Redis data restored"));
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      console.log(c.fail(`failed — ${msg.slice(0, 80)}`));
    }
  } else { console.log(c.ok("(dry-run)")); }

  // ── Summary ────────────────────────────────────────────────────────────────
  const dur = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\n${c.bold("Restore complete")} (${dur}s)\n`);

  console.log(c.warn("MANUAL STEPS REQUIRED:"));
  console.log(`  1. Copy your ${c.bold(".env")} file (not included in backup — contains secrets)`);
  console.log(`     Template: ${c.bold(".env.backup.template")} in the project root`);
  console.log(`  2. Run ${c.bold("npm run health")} to validate all systems`);
  console.log(`  3. Run ${c.bold("npm run typecheck")} to verify TypeScript`);
  console.log(`  4. Test email: ${c.bold("tsx scripts/run-email.ts --test-to your@email.com --dry-run")}`);
  console.log();
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${c.bold("AI Cognitive Runtime — Restore System")}`);

  if (LIST) { listBackups(); return; }
  if (!BACKUP) {
    console.log("\nUsage:");
    console.log("  tsx scripts/restore-runtime.ts --list");
    console.log("  tsx scripts/restore-runtime.ts --backup <id-or-path> [--skip-db] [--dry-run] [--force]");
    console.log();
    process.exit(1);
  }

  await restoreBackup(BACKUP);
}

main().catch(err => { console.error(c.fail(String(err))); process.exit(1); });
