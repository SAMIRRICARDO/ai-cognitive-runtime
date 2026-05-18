#!/usr/bin/env tsx
/**
 * Memory management CLI.
 *
 * Commands:
 *   tsx scripts/memory.ts stats [agent]
 *   tsx scripts/memory.ts search "<query>" [agent]
 *   tsx scripts/memory.ts consolidate [agent]
 *   tsx scripts/memory.ts prune [agent]
 *   tsx scripts/memory.ts maintain [agent]   ← consolidate + prune
 *   tsx scripts/memory.ts extract <agent> "<user_msg>" "<agent_output>"
 */
import { memoryManager } from "../memory/manager.js";
import { MemoryManagerAgent } from "../agents/memory-manager/agent.js";

const [, , command, ...rest] = process.argv;

await memoryManager.initialize();

switch (command) {
  case "stats": {
    const s = await memoryManager.stats(rest[0]);
    console.log("\n=== Memory Stats ===\n");
    console.table((s.byType as any[]).map((r: any) => ({
      agent: r.agent_name ?? rest[0] ?? "all",
      type: r.type,
      count: Number(r.count),
      avg_importance: Number(r.avg_importance).toFixed(2),
    })));
    break;
  }

  case "search": {
    const [query, agentName] = rest;
    if (!query) { console.error("Usage: memory.ts search \"<query>\" [agent]"); process.exit(1); }
    const results = await memoryManager.search(query, { agentName, limit: 10 });
    console.log(`\n${results.length} results for "${query}":\n`);
    for (const r of results) {
      console.log(`  [${r.type}] score=${r.score.toFixed(3)} importance=${r.importance.toFixed(1)}`);
      console.log(`  ${r.content}`);
      console.log(`  tags: ${r.tags.join(", ")} | agent: ${r.agentName} | ${r.createdAt.split("T")[0]}\n`);
    }
    break;
  }

  case "consolidate": {
    const result = await memoryManager.consolidate(rest[0]);
    console.log(`\nConsolidated: merged=${result.merged} kept=${result.kept}`);
    break;
  }

  case "prune": {
    const removed = await memoryManager.prune(rest[0]);
    console.log(`\nPruned ${removed} stale memories`);
    break;
  }

  case "maintain": {
    const mgr = await MemoryManagerAgent.create(rest[0] ?? "global");
    const result = await mgr.maintain(rest[0]);
    console.log(`\nMaintenance done: deduped=${result.deduped} compressed=${result.compressed} summarized=${result.summarized} pruned=${result.pruned} cost=$${result.totalCostUsd.toFixed(6)}`);
    break;
  }

  case "extract": {
    const [agentName, userMsg, agentOutput] = rest;
    if (!agentName || !userMsg || !agentOutput) {
      console.error('Usage: memory.ts extract <agent> "<user_msg>" "<agent_output>"');
      process.exit(1);
    }
    const mgr = await MemoryManagerAgent.create(agentName);
    const memories = await mgr.extractFromRun({ agentName, userMessage: userMsg, agentOutput });
    console.log(`\nExtracted ${memories.length} memories:`);
    for (const m of memories) {
      console.log(`  [${m.type}] (${m.importance}) ${m.content}`);
    }
    break;
  }

  default:
    console.error("Commands: stats | search | consolidate | prune | maintain | extract");
    process.exit(1);
}

await memoryManager.close();
