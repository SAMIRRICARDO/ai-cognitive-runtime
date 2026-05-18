#!/usr/bin/env tsx
/**
 * Print a cost report for one or more agents.
 * Usage: tsx scripts/cost-report.ts [agent1 agent2 ...]
 * Default agents: researcher, coder
 */
import { getCostForAgent, formatCost } from "../config/costs.js";

const agents = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : ["researcher", "coder"];

console.log("\n=== Agent Cost Report ===\n");

for (const name of agents) {
  const record = await getCostForAgent(name);
  if (!record) {
    console.log(`  ${name}: no data`);
    continue;
  }

  const avgCost = record.runs > 0 ? record.totalCostUsd / record.runs : 0;

  console.log(`  ${name} (${record.runs} runs, model: ${record.model})`);
  console.log(`    total:    ${formatCost(record.totalCostUsd)}`);
  console.log(`    avg/run:  ${formatCost(avgCost)}`);
  console.log(`    saved:    ${formatCost(record.totalSavingsUsd)} (via prompt caching)`);
  console.log(`    tokens:   in=${record.totalInputTokens.toLocaleString()} out=${record.totalOutputTokens.toLocaleString()} cache_read=${record.totalCacheReadTokens.toLocaleString()}`);
  console.log(`    last run: ${record.lastRunAt}`);
  console.log();
}
