#!/usr/bin/env tsx
import { promises as dns } from "node:dns";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

type ValidationStatus =
  | "confirmed_exists"
  | "valid_domain_only"
  | "rejected"
  | "invalid_domain"
  | "invalid_syntax"
  | "blocked"
  | "inconclusive";

type LeadContext = {
  sourceFile: string;
  emailField: string;
  company: string;
  name: string;
  role: string;
  campaign: string;
  previousStatus: string;
  sourceKind: "direct" | "candidate";
};

type EmailEntry = {
  email: string;
  contexts: LeadContext[];
};

type ValidationResult = {
  email: string;
  domain: string;
  status: ValidationStatus;
  reason: string;
  mxHosts: string[];
  smtpCode?: number;
  checkedAt: string;
  smtpNoDataSent: true;
  blockedByDoNotContact: boolean;
  contexts: LeadContext[];
};

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "data", "leads", "validated");
const DATE_KEY = new Date().toISOString().slice(0, 10);
const JSON_OUT = path.join(OUT_DIR, `all-leads-email-existence-report-${DATE_KEY}.json`);
const CSV_OUT = path.join(OUT_DIR, `all-leads-email-existence-report-${DATE_KEY}.csv`);
const MD_OUT = path.join(OUT_DIR, `all-leads-email-existence-report-${DATE_KEY}.md`);
const SMTP_FROM = "validator@ialeads.local";
const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const hasFlag = (name: string) => args.includes(name);
const flagValue = (name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const INCLUDE_CANDIDATES = hasFlag("--include-candidates");
const MX_ONLY = hasFlag("--mx-only");
const SMTP_TIMEOUT_MS = Number(flagValue("--smtp-timeout-ms") ?? "5000");
const CONCURRENCY = Math.max(1, Math.min(Number(flagValue("--concurrency") ?? "4"), 8));

const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", "backups"]);
const SKIP_FILE_PARTS = [
  `${path.sep}data${path.sep}leads${path.sep}blocklist${path.sep}`,
  ".lead-acquisition-state.json",
  "companies-seed.json",
  "all-leads-email-existence-report-",
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase().replace(/^mailto:/, "");
  if (!email || email === "unknown" || email === "not_enriched") return null;
  return email;
}

function getString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

async function walkJsonFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const output: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) output.push(...await walkJsonFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) output.push(fullPath);
  }
  return output;
}

function addEntry(entries: Map<string, EmailEntry>, email: string, context: LeadContext) {
  const existing = entries.get(email);
  if (existing) {
    existing.contexts.push(context);
    return;
  }
  entries.set(email, { email, contexts: [context] });
}

function collectFromObject(
  value: unknown,
  sourceFile: string,
  entries: Map<string, EmailEntry>,
  inherited: Partial<LeadContext> = {},
) {
  if (Array.isArray(value)) {
    for (const item of value) collectFromObject(item, sourceFile, entries, inherited);
    return;
  }

  const record = asRecord(value);
  if (!record) return;

  const campaign = getString(record, ["campaign", "campaignId", "targetEvent"]) || inherited.campaign || "";
  const contextBase: Omit<LeadContext, "emailField" | "sourceKind"> = {
    sourceFile: path.relative(ROOT, sourceFile),
    company: getString(record, ["company", "company_name", "companyName", "empresa"]) || inherited.company || "",
    name: getString(record, ["contactName", "full_name", "name", "nome", "leadName"]) || inherited.name || "",
    role: getString(record, ["role", "job_title", "cargo", "title"]) || inherited.role || "",
    campaign,
    previousStatus: getString(record, ["email_status", "status", "deliverabilityStatus", "confidence"]),
  };

  for (const field of ["email", "primaryEmail", "possibleEmail", "email_validado"]) {
    const email = cleanEmail(record[field]);
    if (email) {
      addEntry(entries, email, { ...contextBase, emailField: field, sourceKind: "direct" });
    }
  }

  if (INCLUDE_CANDIDATES) {
    for (const field of ["guessedEmails", "email_candidates"]) {
      const list = record[field];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const itemRecord = asRecord(item);
        const email = cleanEmail(itemRecord?.email);
        if (email) {
          addEntry(entries, email, { ...contextBase, emailField: `${field}.email`, sourceKind: "candidate" });
        }
      }
    }
  }

  for (const [key, child] of Object.entries(record)) {
    if (["guessedEmails", "email_candidates"].includes(key)) continue;
    if (child && typeof child === "object") {
      collectFromObject(child, sourceFile, entries, contextBase);
    }
  }
}

async function loadBlockedEmails(): Promise<Set<string>> {
  const blocklistPath = path.join(ROOT, "data", "leads", "blocklist", "do-not-contact-latest.json");
  if (!existsSync(blocklistPath)) return new Set();
  const raw = JSON.parse(await readFile(blocklistPath, "utf8")) as { emails?: string[] };
  return new Set((raw.emails ?? []).map((email) => email.toLowerCase()));
}

function parseSmtpCode(response: string): number | undefined {
  const match = response.match(/^(\d{3})/m);
  return match ? Number(match[1]) : undefined;
}

function readSmtpResponse(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
    };
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lastLine = buffer.split(/\r?\n/).filter(Boolean).at(-1);
      if (lastLine && /^\d{3} /.test(lastLine)) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error("SMTP timeout"));
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
  });
}

function connectSmtp(host: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: 25 });
    socket.setTimeout(SMTP_TIMEOUT_MS);
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
    };
    const onConnect = () => {
      cleanup();
      resolve(socket);
    };
    const onError = (error: Error) => {
      cleanup();
      socket.destroy();
      reject(error);
    };
    const onTimeout = () => {
      cleanup();
      socket.destroy();
      reject(new Error("SMTP connection timeout"));
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
  });
}

async function sendSmtp(socket: net.Socket, command: string): Promise<string> {
  socket.write(`${command}\r\n`);
  return readSmtpResponse(socket);
}

async function smtpValidate(mxHost: string, email: string): Promise<{ status: ValidationStatus; reason: string; smtpCode?: number }> {
  let socket: net.Socket | undefined;
  try {
    socket = await connectSmtp(mxHost);
    const greetingCode = parseSmtpCode(await readSmtpResponse(socket));
    if (!greetingCode || greetingCode >= 400) {
      return { status: "inconclusive", reason: `SMTP greeting ${greetingCode ?? "unknown"}`, smtpCode: greetingCode };
    }
    const ehloCode = parseSmtpCode(await sendSmtp(socket, "EHLO ialeads.local"));
    if (!ehloCode || ehloCode >= 400) {
      return { status: "inconclusive", reason: `EHLO ${ehloCode ?? "unknown"}`, smtpCode: ehloCode };
    }
    const mailCode = parseSmtpCode(await sendSmtp(socket, `MAIL FROM:<${SMTP_FROM}>`));
    if (!mailCode || mailCode >= 400) {
      return { status: "inconclusive", reason: `MAIL FROM ${mailCode ?? "unknown"}`, smtpCode: mailCode };
    }
    const rcptCode = parseSmtpCode(await sendSmtp(socket, `RCPT TO:<${email}>`));
    await sendSmtp(socket, "QUIT").catch(() => undefined);
    if (rcptCode === 250 || rcptCode === 251) {
      return { status: "confirmed_exists", reason: `RCPT TO confirmed ${rcptCode}`, smtpCode: rcptCode };
    }
    if (rcptCode && rcptCode >= 500) {
      return { status: "rejected", reason: `RCPT TO rejected ${rcptCode}`, smtpCode: rcptCode };
    }
    return { status: "inconclusive", reason: `RCPT TO inconclusive ${rcptCode ?? "unknown"}`, smtpCode: rcptCode };
  } catch (error) {
    return { status: "valid_domain_only", reason: error instanceof Error ? error.message : "SMTP failed" };
  } finally {
    socket?.destroy();
  }
}

const mxCache = new Map<string, string[]>();

async function resolveMx(domain: string): Promise<string[]> {
  const cached = mxCache.get(domain);
  if (cached) return cached;
  try {
    const records = await dns.resolveMx(domain);
    const hosts = records.sort((a, b) => a.priority - b.priority).map((record) => record.exchange);
    mxCache.set(domain, hosts);
    return hosts;
  } catch {
    const command = [
      "$ErrorActionPreference = 'Stop';",
      `Resolve-DnsName -Type MX '${domain.replace(/'/g, "''")}' |`,
      "Select-Object NameExchange,Preference |",
      "Sort-Object Preference |",
      "ConvertTo-Json -Compress",
    ].join(" ");
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], { timeout: 10000 });
    const parsed = JSON.parse(stdout.trim() || "[]") as { NameExchange?: string; Preference?: number } | Array<{ NameExchange?: string; Preference?: number }>;
    const records = Array.isArray(parsed) ? parsed : [parsed];
    const hosts = records
      .map((record) => record.NameExchange)
      .filter((host): host is string => Boolean(host));
    mxCache.set(domain, hosts);
    return hosts;
  }
}

async function validateEntry(entry: EmailEntry, blockedEmails: Set<string>): Promise<ValidationResult> {
  const checkedAt = new Date().toISOString();
  const blockedByDoNotContact = blockedEmails.has(entry.email);
  const domain = entry.email.split("@")[1] ?? "";
  const base = {
    email: entry.email,
    domain,
    mxHosts: [],
    checkedAt,
    smtpNoDataSent: true as const,
    blockedByDoNotContact,
    contexts: entry.contexts,
  };

  if (!EMAIL_RE.test(entry.email)) {
    return { ...base, status: "invalid_syntax", reason: "invalid email syntax" };
  }
  if (blockedByDoNotContact) {
    return { ...base, status: "blocked", reason: "present in do-not-contact blocklist" };
  }

  try {
    const mxHosts = await resolveMx(domain);
    if (mxHosts.length === 0) {
      return { ...base, mxHosts, status: "invalid_domain", reason: "no MX record" };
    }
    if (MX_ONLY) {
      return { ...base, mxHosts, status: "valid_domain_only", reason: "MX record present; mailbox not SMTP-checked" };
    }
    const smtp = await smtpValidate(mxHosts[0]!, entry.email);
    return { ...base, mxHosts, status: smtp.status, reason: smtp.reason, smtpCode: smtp.smtpCode };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
    const reason = error instanceof Error ? error.message : "DNS lookup failed";
    const status: ValidationStatus = code === "ENODATA" || code === "ENOTFOUND" ? "invalid_domain" : "inconclusive";
    return { ...base, status, reason };
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function countByStatus(results: ValidationResult[]) {
  const counts: Record<ValidationStatus, number> = {
    confirmed_exists: 0,
    valid_domain_only: 0,
    rejected: 0,
    invalid_domain: 0,
    invalid_syntax: 0,
    blocked: 0,
    inconclusive: 0,
  };
  for (const result of results) counts[result.status] += 1;
  return counts;
}

async function main() {
  const sourceFiles = [
    ...await walkJsonFiles(path.join(ROOT, "data", "leads")),
    path.join(ROOT, "leads_validados_2026-06-03.json"),
    ...await walkJsonFiles(path.join(ROOT, "dados_imprensa_linkedin")),
  ].filter((file) =>
    existsSync(file) &&
    !SKIP_FILE_PARTS.some((part) => file.includes(part))
  );

  const entries = new Map<string, EmailEntry>();
  for (const file of sourceFiles) {
    const raw = await readFile(file, "utf8");
    try {
      collectFromObject(JSON.parse(raw.replace(/^\uFEFF/, "")), file, entries);
    } catch {
      // Ignore malformed JSON files in the lead corpus.
    }
  }

  const emailEntries = [...entries.values()].sort((a, b) => a.email.localeCompare(b.email));
  const blockedEmails = await loadBlockedEmails();

  console.error(`Collected ${emailEntries.length} unique email(s) from ${sourceFiles.length} source file(s).`);
  console.error(MX_ONLY ? "Mode: MX only." : `Mode: MX + SMTP RCPT, concurrency ${CONCURRENCY}, timeout ${SMTP_TIMEOUT_MS}ms.`);

  const results = await mapWithConcurrency(emailEntries, CONCURRENCY, async (entry, index) => {
    const result = await validateEntry(entry, blockedEmails);
    console.error(`[${index + 1}/${emailEntries.length}] ${result.status} ${entry.email}`);
    return result;
  });

  const counts = countByStatus(results);
  const confirmed = results.filter((result) => result.status === "confirmed_exists");
  const deliverableCandidates = results.filter((result) =>
    result.status === "confirmed_exists" || result.status === "valid_domain_only"
  );

  const payload = {
    _meta: {
      description: "All lead email existence validation report. SMTP uses RCPT TO only; no DATA/message is sent.",
      generatedAt: new Date().toISOString(),
      sourceFiles: sourceFiles.map((file) => path.relative(ROOT, file)),
      totalUniqueEmails: results.length,
      directOnly: !INCLUDE_CANDIDATES,
      mxOnly: MX_ONLY,
      smtpNoDataSent: true,
      counts,
      confirmedExists: confirmed.length,
      deliverableCandidates: deliverableCandidates.length,
    },
    confirmedExists: confirmed,
    deliverableCandidates,
    allResults: results,
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(JSON_OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const csvRows = [
    [
      "status",
      "email",
      "domain",
      "reason",
      "smtpCode",
      "mxHosts",
      "blockedByDoNotContact",
      "contextCount",
      "companies",
      "names",
      "roles",
      "campaigns",
      "sourceFiles",
    ].join(","),
    ...results.map((result) => [
      result.status,
      result.email,
      result.domain,
      result.reason,
      result.smtpCode ?? "",
      result.mxHosts.join(";"),
      result.blockedByDoNotContact,
      result.contexts.length,
      [...new Set(result.contexts.map((context) => context.company).filter(Boolean))].join("; "),
      [...new Set(result.contexts.map((context) => context.name).filter(Boolean))].join("; "),
      [...new Set(result.contexts.map((context) => context.role).filter(Boolean))].join("; "),
      [...new Set(result.contexts.map((context) => context.campaign).filter(Boolean))].join("; "),
      [...new Set(result.contexts.map((context) => context.sourceFile))].join("; "),
    ].map(csvEscape).join(",")),
  ];
  await writeFile(CSV_OUT, `${csvRows.join("\n")}\n`, "utf8");

  const md = [
    "# All Leads Email Existence Report",
    "",
    `Generated at: ${payload._meta.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Unique emails checked: ${results.length}`,
    `- Confirmed mailbox exists by SMTP RCPT: ${counts.confirmed_exists}`,
    `- Valid domain/MX but mailbox not confirmed: ${counts.valid_domain_only}`,
    `- Rejected by SMTP: ${counts.rejected}`,
    `- Invalid domain/no MX: ${counts.invalid_domain}`,
    `- Invalid syntax: ${counts.invalid_syntax}`,
    `- Blocked by do-not-contact: ${counts.blocked}`,
    `- Inconclusive: ${counts.inconclusive}`,
    "",
    "## Confirmed Exists",
    "",
    confirmed.length
      ? confirmed.map((result) => `- ${result.email} | ${[...new Set(result.contexts.map((context) => context.company).filter(Boolean))].join("; ")} | ${result.reason}`).join("\n")
      : "- None confirmed by SMTP RCPT.",
    "",
    "## Notes",
    "",
    "- SMTP validation used RCPT TO only; no DATA command or email message was sent.",
    "- Many corporate servers block SMTP validation or accept all recipients, so valid_domain_only is a deliverability candidate, not proof that the mailbox exists.",
    `- Full JSON: ${path.relative(ROOT, JSON_OUT)}`,
    `- CSV: ${path.relative(ROOT, CSV_OUT)}`,
    "",
  ].join("\n");
  await writeFile(MD_OUT, md, "utf8");

  console.log(JSON.stringify({
    totalUniqueEmails: results.length,
    counts,
    json: path.relative(ROOT, JSON_OUT),
    csv: path.relative(ROOT, CSV_OUT),
    md: path.relative(ROOT, MD_OUT),
  }, null, 2));
}

await main();
