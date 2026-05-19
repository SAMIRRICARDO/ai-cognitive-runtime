#!/usr/bin/env tsx
/**
 * system-health.ts — AI Cognitive Runtime health check
 *
 * Usage:
 *   tsx scripts/system-health.ts [--json] [--verbose]
 *
 * Exit codes:
 *   0 = all systems healthy
 *   1 = degraded (some non-critical systems down)
 *   2 = critical (core systems unavailable)
 */
import { execSync } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = resolve(__dirname, "..");

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const flag    = (f: string) => args.includes(f);

const JSON_OUT = flag("--json");
const VERBOSE  = flag("--verbose");

// ─── Colors ───────────────────────────────────────────────────────────────────

const USE_COLOR = !JSON_OUT && process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  ok:   (s: string) => USE_COLOR ? `\x1b[32m✓\x1b[0m ${s}` : `✓ ${s}`,
  fail: (s: string) => USE_COLOR ? `\x1b[31m✗\x1b[0m ${s}` : `✗ ${s}`,
  warn: (s: string) => USE_COLOR ? `\x1b[33m⚠\x1b[0m ${s}` : `⚠ ${s}`,
  skip: (s: string) => USE_COLOR ? `\x1b[2m○\x1b[0m ${s}` : `○ ${s}`,
  bold: (s: string) => USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s,
  dim:  (s: string) => USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s,
};

// ─── Types ────────────────────────────────────────────────────────────────────

type HealthStatus = "ok" | "degraded" | "down" | "skipped";

interface CheckResult {
  name: string;
  status: HealthStatus;
  detail: string;
  critical: boolean;
}

// ─── Check utilities ──────────────────────────────────────────────────────────

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
  return execSync(resolved, { stdio: "pipe", timeout: 8_000, cwd: ROOT }).toString().trim();
}

function tryExec(cmd: string): string | null {
  try { return exec(cmd); } catch { return null; }
}

// ─── Individual checks ────────────────────────────────────────────────────────

async function checks(env: Record<string, string | undefined>): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const add = (name: string, status: HealthStatus, detail: string, critical = false) =>
    results.push({ name, status, detail, critical });

  // ── Node.js version ─────────────────────────────────────────────────────────
  const nodeVer = process.version;
  const nodeMajor = parseInt(nodeVer.slice(1));
  add("Node.js", nodeMajor >= 22 ? "ok" : "degraded",
    `${nodeVer} (required: ≥22)`, false);

  // ── Anthropic API key ────────────────────────────────────────────────────────
  const antKey = env.ANTHROPIC_API_KEY ?? "";
  if (!antKey) {
    add("Anthropic API", "down", "ANTHROPIC_API_KEY not set", true);
  } else if (!antKey.startsWith("sk-ant-")) {
    add("Anthropic API", "degraded", "Key format unexpected (should start with sk-ant-)");
  } else {
    add("Anthropic API", "ok", `Key configured (${antKey.slice(0, 16)}...)`, true);
  }

  // ── Resend API key ───────────────────────────────────────────────────────────
  const resKey = env.RESEND_API_KEY ?? "";
  if (!resKey) {
    add("Resend Email", "degraded", "RESEND_API_KEY not set — email delivery disabled");
  } else if (!resKey.startsWith("re_")) {
    add("Resend Email", "degraded", "Key format unexpected (should start with re_)");
  } else {
    add("Resend Email", "ok",
      `Key configured (${resKey.slice(0, 10)}...) | From: ${env.RESEND_FROM_EMAIL ?? "not set"}`);
  }

  // ── Docker availability ──────────────────────────────────────────────────────
  const dockerOk = tryExec("docker info --format '{{.ServerVersion}}'");
  if (!dockerOk) {
    add("Docker", "down", "Docker not running or not installed");
  } else {
    add("Docker", "ok", `v${dockerOk}`);
  }

  // ── Redis ────────────────────────────────────────────────────────────────────
  const redisPong = tryExec("docker exec ai-lab-redis redis-cli ping");
  if (redisPong === "PONG") {
    const info = tryExec("docker exec ai-lab-redis redis-cli INFO server") ?? "";
    const ver  = info.match(/redis_version:([^\r\n]+)/)?.[1]?.trim() ?? "unknown";
    add("Redis", "ok", `v${ver} — PONG`);
  } else {
    add("Redis", "degraded", "Container not running (npm run infra:up)");
  }

  // ── PostgreSQL + pgvector ────────────────────────────────────────────────────
  const pgReady = tryExec("docker exec ai-lab-postgres pg_isready -U ailab -d ai_lab");
  if (pgReady?.includes("accepting connections")) {
    const pgVec = tryExec(
      "docker exec ai-lab-postgres psql -U ailab -d ai_lab -c \"SELECT default_version FROM pg_available_extensions WHERE name='vector'\" -t"
    )?.trim() ?? "unknown";
    add("PostgreSQL+pgvector", "ok", `pgvector v${pgVec}`);
  } else {
    const memEnabled = env.ENABLE_MEMORY;
    if (memEnabled === "false") {
      add("PostgreSQL+pgvector", "skipped", "ENABLE_MEMORY=false (lean mode)");
    } else {
      add("PostgreSQL+pgvector", "degraded", "Container not running (npm run infra:up)");
    }
  }

  // ── OpenAI (embeddings) ──────────────────────────────────────────────────────
  const oaiKey = env.OPENAI_API_KEY ?? "";
  if (!oaiKey) {
    const memEnabled = env.ENABLE_MEMORY;
    if (memEnabled === "false") {
      add("OpenAI Embeddings", "skipped", "ENABLE_MEMORY=false — embeddings not needed");
    } else {
      add("OpenAI Embeddings", "degraded", "OPENAI_API_KEY not set — memory search will fail");
    }
  } else {
    add("OpenAI Embeddings", "ok", `Key configured (${oaiKey.slice(0, 14)}...)`);
  }

  // ── Media kit PDF ────────────────────────────────────────────────────────────
  const pdfPath = env.MEDIA_KIT_PDF ?? "./assets/pdfs/vrashows_media_kit_optimized.pdf";
  const pdfAbs  = join(ROOT, pdfPath);
  if (existsSync(pdfAbs)) {
    const sizeKb = Math.round(statSync(pdfAbs).size / 1024);
    add("Media Kit PDF", "ok", `${pdfPath} (${sizeKb} KB)`);
  } else {
    add("Media Kit PDF", "degraded", `Not found: ${pdfPath} — cold outreach attachments will fail`);
  }

  // ── Backups status ───────────────────────────────────────────────────────────
  const manifestsDir = join(ROOT, "backups", "manifests");
  if (!existsSync(manifestsDir) || readdirSync(manifestsDir).length === 0) {
    add("Backups", "degraded", "No backups found — run: npm run backup");
  } else {
    const manifests = readdirSync(manifestsDir)
      .map(f => statSync(join(manifestsDir, f)).mtime.getTime())
      .sort((a, b) => b - a);
    const latestMs  = manifests[0];
    const ageHours  = Math.round((Date.now() - latestMs) / 3_600_000);
    const status: HealthStatus = ageHours > 168 ? "degraded" : "ok"; // warn if > 7 days
    add("Backups", status,
      `Last backup: ${ageHours}h ago | ${manifests.length} total`);
  }

  // ── Git status ───────────────────────────────────────────────────────────────
  const gitCommit = tryExec("git rev-parse --short HEAD");
  const gitBranch = tryExec("git rev-parse --abbrev-ref HEAD");
  const gitDirty  = (tryExec("git status --porcelain") ?? "").length > 0;
  if (gitCommit) {
    add("Git", "ok", `${gitCommit} (${gitBranch})${gitDirty ? " ⚠ uncommitted changes" : ""}`);
  } else {
    add("Git", "degraded", "Not a git repository or git not installed");
  }

  // ── Cost mode ────────────────────────────────────────────────────────────────
  const devMode   = env.DEV_MODE === "true";
  const cheapMode = env.CHEAP_MODE === "true";
  const model     = env.DEFAULT_MODEL ?? "claude-haiku-4-5-20251001";
  const maxIter   = env.MAX_TOOL_ITERATIONS ?? "10 (default)";
  const maxTok    = env.MAX_OUTPUT_TOKENS ?? "8192 (default)";
  add("Cost Mode", "ok",
    `${devMode || cheapMode ? "CHEAP 💰" : "PRODUCTION"} | model: ${model} | iterations: ${maxIter} | tokens: ${maxTok}`);

  // ── Critical files ───────────────────────────────────────────────────────────
  const criticalFiles = ["package.json", "tsconfig.json", "docker-compose.yml", ".env.example", "CLAUDE.md"];
  const missing = criticalFiles.filter(f => !existsSync(join(ROOT, f)));
  if (missing.length === 0) {
    add("Critical Files", "ok", criticalFiles.join(", "));
  } else {
    add("Critical Files", "down", `Missing: ${missing.join(", ")}`, true);
  }

  // ── TypeScript check ─────────────────────────────────────────────────────────
  if (VERBOSE) {
    const tsc = tryExec("npx tsc --noEmit 2>&1");
    if (tsc === null || tsc === "") {
      add("TypeScript", "ok", "zero errors");
    } else {
      const errorCount = (tsc.match(/error TS/g) ?? []).length;
      add("TypeScript", errorCount > 0 ? "down" : "ok",
        errorCount > 0 ? `${errorCount} type errors` : "ok");
    }
  }

  return results;
}

// ─── Display ─────────────────────────────────────────────────────────────────

function display(results: CheckResult[]): number {
  const ok       = results.filter(r => r.status === "ok").length;
  const degraded = results.filter(r => r.status === "degraded").length;
  const down     = results.filter(r => r.status === "down").length;
  const skipped  = results.filter(r => r.status === "skipped").length;

  console.log(`\n${c.bold("AI Cognitive Runtime — System Health")}\n`);

  for (const r of results) {
    const icon = r.status === "ok" ? c.ok : r.status === "degraded" ? c.warn :
                 r.status === "down" ? c.fail : c.skip;
    const label = `${r.name}`.padEnd(24);
    console.log(`  ${icon(`${label} ${c.dim(r.detail)}`)}`);
  }

  const criticalDown = results.filter(r => r.critical && r.status === "down").length;
  const exitCode = criticalDown > 0 ? 2 : down > 0 || degraded > 0 ? 1 : 0;
  const overallLabel = exitCode === 0 ? c.ok("All systems healthy") :
                       exitCode === 1 ? c.warn("Degraded") : c.fail("Critical issues detected");

  console.log(`\n  ${overallLabel}`);
  console.log(c.dim(`  ✓ ${ok} ok  ⚠ ${degraded} degraded  ✗ ${down} down  ○ ${skipped} skipped`));
  console.log();

  return exitCode;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Load env silently
  try {
    const { config } = await import("dotenv");
    config({ path: join(ROOT, ".env") });
  } catch {}

  const env = process.env as Record<string, string | undefined>;
  const results = await checks(env);

  if (JSON_OUT) {
    const exitCode = results.some(r => r.critical && r.status === "down") ? 2 :
                     results.some(r => r.status !== "ok" && r.status !== "skipped") ? 1 : 0;
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), checks: results, exitCode }, null, 2));
    process.exit(exitCode);
  }

  const exitCode = display(results);
  process.exit(exitCode);
}

main().catch(err => { console.error(c.fail(String(err))); process.exit(2); });
