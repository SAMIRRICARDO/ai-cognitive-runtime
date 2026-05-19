#!/usr/bin/env tsx
/**
 * backup-runtime.ts — AI Cognitive Runtime backup system
 *
 * Usage:
 *   tsx scripts/backup-runtime.ts [--type daily|weekly|snapshot] [--label <name>]
 *                                  [--skip-db] [--dry-run]
 *
 * Examples:
 *   tsx scripts/backup-runtime.ts
 *   tsx scripts/backup-runtime.ts --type weekly
 *   tsx scripts/backup-runtime.ts --type snapshot --label "pre-v2-deploy"
 *   tsx scripts/backup-runtime.ts --dry-run
 */
import { execSync } from "child_process";
import { createHash } from "crypto";
import {
  existsSync, mkdirSync, cpSync, writeFileSync,
  readdirSync, statSync, readFileSync, rmSync,
} from "fs";
import { join, resolve, basename } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

// ─── Setup ────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = resolve(__dirname, "..");
const BACKUPS    = join(ROOT, "backups");

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const flag    = (f: string) => args.includes(f);
const flagVal = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };

const TYPE    = (flagVal("--type") ?? "daily") as "daily" | "weekly" | "snapshot";
const LABEL   = flagVal("--label") ?? "";
const DRY_RUN = flag("--dry-run");
const SKIP_DB = flag("--skip-db");

// ─── Colors ───────────────────────────────────────────────────────────────────

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  ok:   (s: string) => USE_COLOR ? `\x1b[32m✓\x1b[0m ${s}` : `✓ ${s}`,
  fail: (s: string) => USE_COLOR ? `\x1b[31m✗\x1b[0m ${s}` : `✗ ${s}`,
  skip: (s: string) => USE_COLOR ? `\x1b[33m⊘\x1b[0m ${s}` : `⊘ ${s}`,
  info: (s: string) => USE_COLOR ? `\x1b[36m→\x1b[0m ${s}` : `→ ${s}`,
  bold: (s: string) => USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s,
  dim:  (s: string) => USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s,
};

// ─── Constants ────────────────────────────────────────────────────────────────

const CODE_DIRS = [
  "agents", "tools", "config", "memory", "workflows",
  "scripts", "prompts", "assets/templates", "data/leads",
  "docs", "infra", "evals", "obsidian-vault",
];

const ROOT_FILES = [
  "package.json", "package-lock.json", "tsconfig.json",
  "docker-compose.yml", ".env.example", ".env.backup.template",
  "CLAUDE.md", "CLAUDE_CONTEXT.md", "AGENT_PLAYBOOK.md", ".gitignore",
];

const COPY_EXCLUDES = /^(node_modules|dist|coverage|\.git|backups|logs)$/;

const RETENTION: Record<string, number> = { daily: 7, weekly: 4, snapshot: 999 };

const CHECKSUM_FILES = [
  "package.json", "package-lock.json", "tsconfig.json",
  "docker-compose.yml", ".env.example",
];

// ─── Utilities ────────────────────────────────────────────────────────────────

function sha256(filePath: string): string {
  if (!existsSync(filePath)) return "missing";
  return createHash("sha256").update(readFileSync(filePath)).digest("hex").slice(0, 16);
}

function dirSizeBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    total += entry.isDirectory() ? dirSizeBytes(p) : (statSync(p).size ?? 0);
  }
  return total;
}

function copyDir(src: string, dest: string): number {
  if (!existsSync(src)) return 0;
  mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (COPY_EXCLUDES.test(entry.name)) continue;
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDir(s, d);
    } else {
      cpSync(s, d);
      count++;
    }
  }
  return count;
}

function gitInfo(): { branch: string; commit: string; tag: string | null; dirty: boolean } {
  const run = (cmd: string) => { try { return execSync(cmd, { cwd: ROOT, stdio: "pipe" }).toString().trim(); } catch { return ""; } };
  return {
    branch: run("git rev-parse --abbrev-ref HEAD"),
    commit: run("git rev-parse --short HEAD"),
    tag:    run("git describe --tags --exact-match 2>/dev/null") || null,
    dirty:  run("git status --porcelain") !== "",
  };
}

function applyRetention(typeDir: string, keep: number): void {
  if (!existsSync(typeDir)) return;
  const entries = readdirSync(typeDir)
    .map(n => ({ name: n, mtime: statSync(join(typeDir, n)).mtime.getTime() }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const entry of entries.slice(keep)) {
    console.log(c.dim(`  Removing old backup: ${entry.name}`));
    if (!DRY_RUN) rmSync(join(typeDir, entry.name), { recursive: true, force: true });
  }
}

// Resolve docker binary — on Windows it may only be in a non-default PATH location
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

function exec(cmd: string): string {
  const resolved = cmd.replace(/^docker\b/, `"${DOCKER}"`);
  return execSync(resolved, { stdio: "pipe", timeout: 60_000 }).toString();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const startMs  = Date.now();
  const now      = new Date();
  const tsDir    = now.toISOString().slice(0, 19).replace(/[T:]/g, "-"); // 2026-05-19-08-00-00
  const tsIso    = now.toISOString();
  const id       = LABEL ? `${LABEL}-${tsDir}` : `backup-${tsDir}`;
  const backupDir = join(BACKUPS, TYPE, id);
  const codeDir   = join(backupDir, "code");
  const pgDir     = join(backupDir, "postgres");
  const redisDir  = join(backupDir, "redis");
  const manifestsDir = join(BACKUPS, "manifests");

  console.log(`\n${c.bold("AI Cognitive Runtime — Backup System")}`);
  console.log(c.dim(`  Type: ${TYPE}  |  ID: ${id}  |  DryRun: ${DRY_RUN}`));
  console.log();

  if (DRY_RUN) console.log(c.bold("[DRY RUN — no files will be written]\n"));

  // ── Directories ─────────────────────────────────────────────────────────────
  if (!DRY_RUN) {
    mkdirSync(backupDir, { recursive: true });
    mkdirSync(manifestsDir, { recursive: true });
    mkdirSync(join(BACKUPS, "daily"),    { recursive: true });
    mkdirSync(join(BACKUPS, "weekly"),   { recursive: true });
    mkdirSync(join(BACKUPS, "snapshots"),{ recursive: true });
  }

  const components: Record<string, { status: string; detail?: string }> = {};

  // ── Code backup ──────────────────────────────────────────────────────────────
  process.stdout.write(c.info("Backing up source code... "));
  let fileCount = 0;
  if (!DRY_RUN) {
    mkdirSync(codeDir, { recursive: true });

    // Source directories
    for (const dir of CODE_DIRS) {
      const src = join(ROOT, dir);
      const dst = join(codeDir, dir);
      mkdirSync(dirname(dst), { recursive: true });
      fileCount += copyDir(src, dst);
    }

    // Root files
    for (const f of ROOT_FILES) {
      const src = join(ROOT, f);
      if (existsSync(src)) { cpSync(src, join(codeDir, f)); fileCount++; }
    }
  }
  console.log(c.ok(`${DRY_RUN ? "(skipped)" : `${fileCount} files`}`));
  components.code = { status: "ok", detail: `${fileCount} files` };

  // ── PostgreSQL dump ──────────────────────────────────────────────────────────
  process.stdout.write(c.info("Backing up PostgreSQL (pgvector)... "));
  if (SKIP_DB) {
    console.log(c.skip("skipped (--skip-db)"));
    components.postgres = { status: "skipped", detail: "--skip-db flag" };
  } else {
    try {
      const pgDumpPath = join(pgDir, "ai_lab.sql");
      if (!DRY_RUN) {
        mkdirSync(pgDir, { recursive: true });
        const dump = exec("docker exec ai-lab-postgres pg_dump -U ailab ai_lab");
        writeFileSync(pgDumpPath, dump, "utf8");
        const sizeKb = Math.round(statSync(pgDumpPath).size / 1024);
        console.log(c.ok(`${sizeKb} KB`));
        components.postgres = { status: "ok", detail: `${sizeKb} KB` };
      } else {
        console.log(c.ok("(dry-run)"));
        components.postgres = { status: "ok", detail: "dry-run" };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      console.log(c.fail(`skipped — ${msg.slice(0, 80)}`));
      components.postgres = { status: "skipped", detail: msg.slice(0, 120) };
    }
  }

  // ── Redis snapshot ───────────────────────────────────────────────────────────
  process.stdout.write(c.info("Backing up Redis snapshot... "));
  if (SKIP_DB) {
    console.log(c.skip("skipped (--skip-db)"));
    components.redis = { status: "skipped", detail: "--skip-db flag" };
  } else {
    try {
      if (!DRY_RUN) {
        mkdirSync(redisDir, { recursive: true });
        exec("docker exec ai-lab-redis redis-cli BGSAVE");
        // Give Redis 2s to finish BGSAVE
        await new Promise<void>(r => setTimeout(r, 2000));
        const rdbDest = join(redisDir, "dump.rdb");
        exec(`docker cp ai-lab-redis:/data/dump.rdb "${rdbDest}"`);
        const sizeKb = existsSync(rdbDest) ? Math.round(statSync(rdbDest).size / 1024) : 0;
        console.log(c.ok(`${sizeKb} KB`));
        components.redis = { status: "ok", detail: `${sizeKb} KB` };
      } else {
        console.log(c.ok("(dry-run)"));
        components.redis = { status: "ok", detail: "dry-run" };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      console.log(c.fail(`skipped — ${msg.slice(0, 80)}`));
      components.redis = { status: "skipped", detail: msg.slice(0, 120) };
    }
  }

  // ── Checksums ────────────────────────────────────────────────────────────────
  const checksums: Record<string, string> = {};
  for (const f of CHECKSUM_FILES) checksums[f] = sha256(join(ROOT, f));

  // ── Git info ─────────────────────────────────────────────────────────────────
  const git = gitInfo();

  // ── Manifest ─────────────────────────────────────────────────────────────────
  const totalSize = DRY_RUN ? 0 : dirSizeBytes(backupDir);
  const manifest = {
    id,
    type: TYPE,
    label: LABEL || undefined,
    timestamp: tsIso,
    git,
    env: {
      nodeVersion:   process.version,
      defaultModel:  process.env.DEFAULT_MODEL ?? "claude-haiku-4-5-20251001",
      enableMemory:  process.env.ENABLE_MEMORY ?? "unknown",
      devMode:       process.env.DEV_MODE ?? "unknown",
      cheapMode:     process.env.CHEAP_MODE ?? "unknown",
      memoryProvider: process.env.MEMORY_PROVIDER ?? "unknown",
    },
    components,
    checksums,
    totalSizeBytes: totalSize,
    durationMs: Date.now() - startMs,
    version: "1.0",
  };

  if (!DRY_RUN) {
    const manifestPath = join(backupDir, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    // Also copy to global manifests dir for fast listing
    writeFileSync(join(manifestsDir, `${id}.json`), JSON.stringify(manifest, null, 2), "utf8");
  }

  // ── Retention ────────────────────────────────────────────────────────────────
  if (!DRY_RUN) {
    const keep = RETENTION[TYPE] ?? 7;
    const typeDir = join(BACKUPS, TYPE);
    applyRetention(typeDir, keep);
    console.log(c.dim(`  Retention: keeping last ${keep} ${TYPE} backups`));
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const dur   = ((Date.now() - startMs) / 1000).toFixed(1);
  const sizeMb = (totalSize / (1024 * 1024)).toFixed(2);

  console.log(`\n${c.bold("Backup complete")}`);
  console.log(c.dim(`  Path:     ${DRY_RUN ? "(dry-run)" : backupDir}`));
  console.log(c.dim(`  Size:     ${DRY_RUN ? "N/A" : sizeMb + " MB"}`));
  console.log(c.dim(`  Duration: ${dur}s`));
  console.log(c.dim(`  Git:      ${git.commit} (${git.branch})${git.dirty ? " [DIRTY]" : ""}`));
  console.log();

  if (DRY_RUN) console.log(c.bold("  Run without --dry-run to execute the backup.\n"));
}

main().catch(err => { console.error(c.fail(String(err))); process.exit(1); });
