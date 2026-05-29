#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { dirname, extname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(ROOT, "data/leads/blocklist");

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LOG_ROOTS = ["logs", "memory/outbound", "data/outreach"];

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const output: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) output.push(...walk(path));
    if (stats.isFile()) output.push(path);
  }
  return output;
}

function safeJson(path: string) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const emails = new Set<string>();
const companies = new Set<string>();

for (const root of LOG_ROOTS) {
  for (const file of walk(resolve(ROOT, root))) {
    const ext = extname(file).toLowerCase();
    if (![".json", ".jsonl", ".csv", ".txt", ".log"].includes(ext)) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(EMAIL_RE)) emails.add(match[0].toLowerCase());

    const json = safeJson(file);
    const items = Array.isArray(json) ? json : json?.results ?? json?.records ?? [];
    if (Array.isArray(items)) {
      for (const item of items) {
        const company = item?.company ?? item?.lead?.company ?? item?.entry?.lead?.company;
        if (typeof company === "string" && company.trim()) companies.add(company.trim().toLowerCase());
      }
    }
  }
}

mkdirSync(OUT_DIR, { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const outPath = resolve(OUT_DIR, `do-not-contact-${date}.json`);
const latestPath = resolve(OUT_DIR, "do-not-contact-latest.json");
const payload = {
  generatedAt: new Date().toISOString(),
  sourceRoots: LOG_ROOTS,
  emailCount: emails.size,
  companyCount: companies.size,
  emails: [...emails].sort(),
  companies: [...companies].sort(),
};

writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
writeFileSync(latestPath, JSON.stringify(payload, null, 2), "utf8");
console.log(JSON.stringify({ outPath, emailCount: emails.size, companyCount: companies.size }));
