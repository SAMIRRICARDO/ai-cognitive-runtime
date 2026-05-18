#!/usr/bin/env tsx
/**
 * Index (or re-index) the Obsidian vault into pgvector.
 *
 * Usage:
 *   tsx scripts/index-vault.ts           # incremental (skip unchanged files)
 *   tsx scripts/index-vault.ts --force   # re-index everything
 *   tsx scripts/index-vault.ts --stats   # show index statistics
 */
import { vaultIndex } from "../memory/long-term/vault-index.js";
import { env } from "../config/env.js";

const args = process.argv.slice(2);
const force  = args.includes("--force");
const stats  = args.includes("--stats");

console.log(`\nVault: ${env.VAULT_PATH}\n`);

await vaultIndex.initialize();

if (stats) {
  const s = await vaultIndex.stats();
  console.log(`Chunks:       ${s.totalChunks.toLocaleString()}`);
  console.log(`Files:        ${s.totalFiles.toLocaleString()}`);
  console.log(`Last indexed: ${s.lastIndexed}`);
} else {
  console.log(force ? "Full re-index..." : "Incremental index (use --force to re-index all)...\n");
  const result = await vaultIndex.indexVault({ force });
  console.log(`Indexed:  ${result.indexed} files`);
  console.log(`Skipped:  ${result.skipped} files (unchanged)`);
  console.log(`Deleted:  ${result.deleted} chunks (removed files)`);
}

await vaultIndex.close();
