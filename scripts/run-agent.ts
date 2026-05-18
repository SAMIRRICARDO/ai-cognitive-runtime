#!/usr/bin/env tsx
/**
 * CLI: tsx scripts/run-agent.ts <agent> [--model auto|<model-id>] "<prompt>"
 *
 * Examples:
 *   tsx scripts/run-agent.ts researcher "What are the latest AI agent frameworks?"
 *   tsx scripts/run-agent.ts coder --model auto "Design a distributed job queue"
 *   tsx scripts/run-agent.ts coder --model claude-haiku-4-5-20251001 "Rename a variable"
 */
import { ResearcherAgent } from "../agents/researcher/agent.js";
import { CoderAgent } from "../agents/coder/agent.js";
import { VaultAgent } from "../agents/vault/agent.js";
import { MemoryManagerAgent } from "../agents/memory-manager/agent.js";
import { FuturecomResearcherAgent } from "../agents/futurecom-researcher/agent.js";
import { OutreachAgent } from "../agents/outreach-agent/agent.js";
import { LeadEnrichmentAgent } from "../agents/lead-enrichment-agent/agent.js";
import { EmailSenderAgent } from "../agents/email-sender-agent/agent.js";
import { withReflection } from "../agents/evaluator/agent.js";
import type { AgentStep } from "../agents/_base/types.js";

// Parse args: agent [--model <value>] [--reflect [rounds]] ...prompt
const args = process.argv.slice(2);
const agentName = args[0];

let modelOverride: string | undefined;
let reflectRounds = 0;

const modelFlagIdx = args.indexOf("--model");
if (modelFlagIdx !== -1) {
  modelOverride = args[modelFlagIdx + 1];
  args.splice(modelFlagIdx, 2);
}

const reflectFlagIdx = args.indexOf("--reflect");
if (reflectFlagIdx !== -1) {
  const maybeN = parseInt(args[reflectFlagIdx + 1] ?? "", 10);
  reflectRounds = isNaN(maybeN) ? 3 : maybeN;
  args.splice(reflectFlagIdx, isNaN(parseInt(args[reflectFlagIdx + 1] ?? "", 10)) ? 1 : 2);
}

const prompt = args.slice(1).join(" ");

if (!agentName || !prompt) {
  console.error('Usage: tsx scripts/run-agent.ts <agent> [--model auto|<model-id>] [--reflect [n]] "<prompt>"');
  process.exit(1);
}

const agentFactories: Record<string, () => Promise<any>> = {
  researcher: () => ResearcherAgent.create(),
  coder: () => CoderAgent.create(),
  vault: () => VaultAgent.create(),
  "memory-manager": () => MemoryManagerAgent.create(),
  "futurecom-researcher": () => FuturecomResearcherAgent.create(),
  "outreach-agent": () => OutreachAgent.create(),
  "lead-enrichment-agent": () => LeadEnrichmentAgent.create(),
  "email-sender-agent": () => EmailSenderAgent.create(),
};

const factory = agentFactories[agentName];
if (!factory) {
  console.error(`Unknown agent: ${agentName}. Available: ${Object.keys(agentFactories).join(", ")}`);
  process.exit(1);
}

const agent = await factory();

// Apply model override (including "auto")
if (modelOverride) {
  (agent as any).config.model = modelOverride;
}

const onStep = (step: AgentStep) => {
  if (step.type === "thinking") {
    process.stdout.write(`\n${step.content}\n`);
  } else if (step.type === "tool_call") {
    process.stdout.write(`\n[tool] ${step.tool}(${JSON.stringify(step.input).slice(0, 80)}...)\n`);
  }
};

if (reflectRounds > 0) {
  // Reflection mode — wrap the agent in an evaluate → reflect loop
  console.log(`\n[reflect] enabled — up to ${reflectRounds} round(s)\n`);

  const refResult = await withReflection(agent, prompt, {
    maxRounds: reflectRounds,
    onRound: (round, eval_, _output) => {
      console.log(`[reflect] round=${round} score=${eval_.score.toFixed(2)} passed=${eval_.passed}`);
      if (!eval_.passed) console.log(`           critique: ${eval_.critique.slice(0, 120)}`);
    },
  });

  console.log("\n--- OUTPUT ---\n");
  console.log(refResult.output);
  console.log(`\n[reflect]  rounds=${refResult.rounds}  passed=${refResult.passed}  score=${refResult.finalEval.score.toFixed(2)}`);
  console.log(`[cost]     $${refResult.totalCostUsd.toFixed(6)}`);
} else {
  const result = await agent.run(prompt, { onStep });

  console.log("\n--- OUTPUT ---\n");
  console.log(result.output);

  const flags = [
    result.fromCache         && "from-cache",
    result.contextCompressed && "ctx-compressed",
  ].filter(Boolean).join(" ");

  if (result.routing) {
    console.log(`\n[routing]  tier=${result.routing.tier}  model=${result.routing.model}  score=${result.routing.score}`);
  }
  if (result.cost) {
    const { totalCostUsd, savings } = result.cost;
    console.log(`[cost]     $${totalCostUsd.toFixed(6)}  saved=$${savings.toFixed(6)}`);
  }
  console.log(`[tokens]   in:${result.usage.inputTokens} out:${result.usage.outputTokens} cache_read:${result.usage.cacheReadTokens} cache_write:${result.usage.cacheCreationTokens}`);
  if (flags) console.log(`[flags]    ${flags}`);
}
