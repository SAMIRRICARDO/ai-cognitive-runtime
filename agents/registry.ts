/**
 * Agent Registry — central catalogue of all available agents.
 *
 * Each entry declares the agent's capabilities so the coordinator and
 * dynamic router can select the right agent for a given task without
 * hard-coding name lists everywhere.
 */

import type { BaseAgent } from "./_base/agent.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AgentCapability =
  | "web-search"
  | "code-generation"
  | "code-review"
  | "vault-search"
  | "memory-management"
  | "task-planning"
  | "evaluation"
  | "summarization"
  | "data-analysis"
  | "lead-intelligence"
  | "lead-classification"
  | "outreach-generation"
  | "contact-enrichment"
  | "email-delivery";

export interface AgentMeta {
  /** Canonical name used in TaskGraphSpec and CLI */
  name: string;

  /** Human-readable description for routing prompts */
  description: string;

  /** Declared capabilities */
  capabilities: AgentCapability[];

  /** Relative cost tier */
  costTier: "low" | "medium" | "high";

  /** Lazy factory */
  factory: () => Promise<BaseAgent>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

class AgentRegistry {
  private entries = new Map<string, AgentMeta>();

  register(meta: AgentMeta): void {
    this.entries.set(meta.name, meta);
  }

  get(name: string): AgentMeta {
    const meta = this.entries.get(name);

    if (!meta) {
      throw new Error(
        `Agent not registered: "${name}". Known: ${[
          ...this.entries.keys(),
        ].join(", ")}`
      );
    }

    return meta;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  all(): AgentMeta[] {
    return [...this.entries.values()];
  }

  withCapabilities(...caps: AgentCapability[]): AgentMeta[] {
    return this.all().filter((a) =>
      caps.every((c) => a.capabilities.includes(c))
    );
  }

  cheapest(...caps: AgentCapability[]): AgentMeta | undefined {
    const tierOrder: Record<AgentMeta["costTier"], number> = {
      low: 0,
      medium: 1,
      high: 2,
    };

    return this.withCapabilities(...caps).sort(
      (a, b) => tierOrder[a.costTier] - tierOrder[b.costTier]
    )[0];
  }

  catalogue(): string {
    return this.all()
      .map(
        (a) =>
          `- ${a.name} (${a.costTier}): ${a.description} | caps: ${a.capabilities.join(
            ", "
          )}`
      )
      .join("\n");
  }

  async instantiate(name: string): Promise<BaseAgent> {
    return this.get(name).factory();
  }
}

export const agentRegistry = new AgentRegistry();

// ─────────────────────────────────────────────────────────────────────────────
// Built-in Agents
// ─────────────────────────────────────────────────────────────────────────────

agentRegistry.register({
  name: "researcher",
  description:
    "Web search, fact-finding, summarisation and market research",
  capabilities: ["web-search", "summarization"],
  costTier: "medium",

  factory: async () => {
    const { ResearcherAgent } = await import(
      "./researcher/agent.js"
    );

    return ResearcherAgent.create();
  },
});

agentRegistry.register({
  name: "coder",
  description:
    "Code generation, debugging, refactoring, tests and CLI tools",

  capabilities: [
    "code-generation",
    "code-review",
    "summarization",
  ],

  costTier: "medium",

  factory: async () => {
    const { CoderAgent } = await import(
      "./coder/agent.js"
    );

    return CoderAgent.create();
  },
});

agentRegistry.register({
  name: "vault",

  description:
    "Semantic and keyword search over the local Obsidian knowledge base",

  capabilities: ["vault-search", "summarization"],

  costTier: "low",

  factory: async () => {
    const { VaultAgent } = await import(
      "./vault/agent.js"
    );

    return VaultAgent.create();
  },
});

agentRegistry.register({
  name: "memory-manager",

  description:
    "Querying and maintaining persistent agent memory",

  capabilities: [
    "memory-management",
    "summarization",
  ],

  costTier: "low",

  factory: async () => {
    const { MemoryManagerAgent } = await import(
      "./memory-manager/agent.js"
    );

    return MemoryManagerAgent.create();
  },
});

agentRegistry.register({
  name: "coordinator",

  description:
    "Task decomposition and multi-agent orchestration",

  capabilities: ["task-planning"],

  costTier: "medium",

  factory: async () => {
    const { CoordinatorAgent } = await import(
      "./coordinator/agent.js"
    );

    return CoordinatorAgent.create();
  },
});

agentRegistry.register({
  name: "evaluator",

  description:
    "Output quality evaluation and scoring against a goal",

  capabilities: ["evaluation", "summarization"],

  costTier: "low",

  factory: async () => {
    const { EvaluatorAgent } = await import(
      "./evaluator/agent.js"
    );

    return EvaluatorAgent.create();
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// VRASHOWS Enterprise Intelligence Agents
// ─────────────────────────────────────────────────────────────────────────────

agentRegistry.register({
  name: "futurecom-researcher",

  description:
    "Enterprise lead intelligence for VRASHOWS — identifies Futurecom exhibitors with high 360° operations potential",

  capabilities: [
    "web-search",
    "lead-intelligence",
    "data-analysis",
    "summarization",
  ],

  costTier: "medium",

  factory: async () => {
    const { FuturecomResearcherAgent } = await import(
      "./futurecom-researcher/agent.js"
    );

    return FuturecomResearcherAgent.create();
  },
});

agentRegistry.register({
  name: "outreach-agent",

  description:
    "Generates consultive enterprise outreach packages for VRASHOWS leads",

  capabilities: [
    "outreach-generation",
    "summarization",
  ],

  costTier: "medium",

  factory: async () => {
    const { OutreachAgent } = await import(
      "./outreach-agent/agent.js"
    );

    return OutreachAgent.create();
  },
});

agentRegistry.register({
  name: "lead-enrichment-agent",

  description:
    "Enriches company leads with decision maker contacts and strategic intelligence",

  capabilities: [
    "web-search",
    "contact-enrichment",
    "lead-intelligence",
    "data-analysis",
  ],

  costTier: "medium",

  factory: async () => {
    const { LeadEnrichmentAgent } = await import(
      "./lead-enrichment-agent/agent.js"
    );

    return LeadEnrichmentAgent.create();
  },
});

agentRegistry.register({
  name: "lead-classifier",

  description:
    "Qualifica respostas de decisores no LinkedIn — classifica variante (A-E), intent e handoff para pipeline B2B",

  capabilities: [
    "lead-classification",
    "lead-intelligence",
    "data-analysis",
  ],

  costTier: "low",

  factory: async () => {
    const { LeadClassifierAgent } = await import(
      "./lead-classifier/agent.js"
    );
    return LeadClassifierAgent.create();
  },
});

agentRegistry.register({
  name: "email-sender-agent",

  description:
    "Sends enterprise outreach emails via Resend API for VRASHOWS",

  capabilities: [
    "email-delivery",
    "outreach-generation",
  ],

  costTier: "low",

  factory: async () => {
    const { EmailSenderAgent } = await import(
      "./email-sender-agent/agent.js"
    );

    return EmailSenderAgent.create();
  },
});