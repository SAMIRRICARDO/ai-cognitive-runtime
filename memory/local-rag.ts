import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MEMORY_ROOT = resolve(ROOT, "memory");

export type LocalRagCollection =
  | "prompts"
  | "outbound"
  | "campaigns"
  | "companies"
  | "logs"
  | "analytics"
  | "leads";

export interface LocalRagRecord {
  id: string;
  collection: LocalRagCollection;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const COLLECTIONS: LocalRagCollection[] = [
  "prompts",
  "outbound",
  "campaigns",
  "companies",
  "logs",
  "analytics",
  "leads",
];

function ensureMemoryTree() {
  for (const collection of COLLECTIONS) {
    mkdirSync(resolve(MEMORY_ROOT, collection), { recursive: true });
  }
}

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function collectionPath(collection: LocalRagCollection) {
  return resolve(MEMORY_ROOT, collection, "index.jsonl");
}

function readCollection(collection: LocalRagCollection): LocalRagRecord[] {
  ensureMemoryTree();
  const path = collectionPath(collection);
  if (!existsSync(path)) return [];

  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LocalRagRecord);
}

function writeCollection(collection: LocalRagCollection, records: LocalRagRecord[]) {
  ensureMemoryTree();
  const path = collectionPath(collection);
  writeFileSync(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
}

export function saveLocalMemory(input: {
  collection: LocalRagCollection;
  content: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  id?: string;
}) {
  ensureMemoryTree();
  const now = new Date().toISOString();
  const records = readCollection(input.collection);
  const id = input.id ?? hash(`${input.collection}:${normalize(input.content)}`);
  const existingIndex = records.findIndex((record) => record.id === id);
  const existing = existingIndex >= 0 ? records[existingIndex] : undefined;
  const record: LocalRagRecord = {
    id,
    collection: input.collection,
    content: input.content,
    tags: input.tags ?? existing?.tags ?? [],
    metadata: input.metadata ?? existing?.metadata ?? {},
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    records[existingIndex] = record;
    writeCollection(input.collection, records);
  } else {
    appendFileSync(collectionPath(input.collection), `${JSON.stringify(record)}\n`, "utf8");
  }

  return record;
}

export function searchLocalMemory(input: {
  query: string;
  collections?: LocalRagCollection[];
  limit?: number;
}) {
  ensureMemoryTree();
  const queryTerms = new Set(normalize(input.query).split(/\s+/).filter(Boolean));
  const collections = input.collections ?? COLLECTIONS;
  const limit = input.limit ?? 5;

  const scored = collections
    .flatMap(readCollection)
    .map((record) => {
      const haystack = normalize(`${record.content} ${record.tags.join(" ")} ${JSON.stringify(record.metadata)}`);
      let score = 0;
      for (const term of queryTerms) {
        if (haystack.includes(term)) score += 1;
      }
      return { ...record, score };
    })
    .filter((record) => record.score > 0)
    .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);

  return scored;
}

export function buildLocalContext(query: string, collections?: LocalRagCollection[], limit = 5) {
  const memories = searchLocalMemory({ query, collections, limit });
  if (memories.length === 0) return "";

  const lines = memories.map((memory) => `- [${memory.collection}] ${memory.content.slice(0, 240)}`);
  return `\nLocal IALEADS context:\n${lines.join("\n")}\n`;
}

ensureMemoryTree();
