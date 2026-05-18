/**
 * Agent Registry — central catalogue of all available agents.
 *
 * Each entry declares the agent's capabilities so the coordinator and
 * dynamic router can select the right agent for a given task without
 * hard-coding name lists everywhere.
 */
import type { BaseAgent } from "./_base/agent.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentCapability =
  | "web-search"
  | "code-generation"
  | "code-review"
  | "vault-search"
  | "memory-management"
  | "task-planning"
  | "evaluation"
  | "summarization"
  | "data-analysis";

export interface AgentMeta {
  /** Canonical name used in TaskGraphSpec and CLI */
  name: string;
  /** Human-readable description for LLM routing prompts */
  description: string;
  /** Declared capabilities — used by dynamic router */
  capabilities: AgentCapability[];
  /** Relative cost tier for routing budget decisions */
  costTier: "low" | "medium" | "high";
  /** Lazy factory — called on demand to avoid importing all agents up-front */
  factory: () => Promise<BaseAgent>;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

class AgentRegistry {
  private entries = new Map<string, AgentMeta>();

  register(meta: AgentMeta): void {
    this.entries.set(meta.name, meta);
  }

  get(name: string): AgentMeta {
    const meta = this.entries.get(name);
    if (!meta) throw new Error(`Agent not registered: "${name}". Known: ${[...this.entries.keys()].join(", ")}`);
    return meta;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  all(): AgentMeta[] {
    return [...this.entries.values()];
  }

  /** Return agents that have ALL of the requested capabilities. */
  withCapabilities(...caps: AgentCapability[]): AgentMeta[] {
    return this.all().filter((a) => caps.every((c) => a.capabilities.includes(c)));
  }

  /** Return the first agent matching all capabilities, ordered by costTier asc. */
  cheapest(...caps: AgentCapability[]): AgentMeta | undefined {
    const tierOrder: Record<AgentMeta["costTier"], number> = { low: 0, medium: 1, high: 2 };
    return this.withCapabilities(...caps).sort(
      (a, b) => tierOrder[a.costTier] - tierOrder[b.costTier]
    )[0];
  }

  /** Produce a concise text catalogue for injection into LLM prompts. */
  catalogue(): string {
    return this.all()
      .map((a) => `- ${a.name} (${a.costTier}): ${a.description} | caps: ${a.capabilities.join(", ")}`)
      .join("\n");
  }

  async instantiate(name: string): Promise<BaseAgent> {
    return this.get(name).factory();
  }
}

export const agentRegistry = new AgentRegistry();

// ─── Built-in registrations ───────────────────────────────────────────────────

agentRegistry.register({
  name: "researcher",
  description: "Web search, fact-finding, summarisation, market research",
  capabilities: ["web-search", "summarization"],
  costTier: "medium",
  factory: async () => {
    const { ResearcherAgent } = await import("./researcher/agent.js");
    return ResearcherAgent.create();
  },
});

agentRegistry.register({
  name: "coder",
  description: "Code generation, debugging, refactoring, tests, CLI tools",
  capabilities: ["code-generation", "code-review", "summarization"],
  costTier: "medium",
  factory: async () => {
    const { CoderAgent } = await import("./coder/agent.js");
    return CoderAgent.create();
  },
});

agentRegistry.register({
  name: "vault",
  description: "Semantic and keyword search over the local Obsidian knowledge base",
  capabilities: ["vault-search", "summarization"],
  costTier: "low",
  factory: async () => {
    const { VaultAgent } = await import("./vault/agent.js");
    return VaultAgent.create();
  },
});

agentRegistry.register({
  name: "memory-manager",
  description: "Querying and maintaining persistent agent memory (episodic, semantic, procedural)",
  capabilities: ["memory-management", "summarization"],
  costTier: "low",
  factory: async () => {
    const { MemoryManagerAgent } = await import("./memory-manager/agent.js");
    return MemoryManagerAgent.create();
  },
});

agentRegistry.register({
  name: "coordinator",
  description: "Task decomposition and multi-agent orchestration",
  capabilities: ["task-planning"],
  costTier: "medium",
  factory: async () => {
    const { CoordinatorAgent } = await import("./coordinator/agent.js");
    return CoordinatorAgent.create();
  },
});

agentRegistry.register({
  name: "evaluator",
  description: "Output quality evaluation and scoring against a goal",
  capabilities: ["evaluation", "summarization"],
  costTier: "low",
  factory: async () => {
    const { EvaluatorAgent } = await import("./evaluator/agent.js");
    return EvaluatorAgent.create();
  },
});
