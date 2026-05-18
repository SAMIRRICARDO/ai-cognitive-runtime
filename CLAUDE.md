# AI Lab — Claude Code Instructions

## Stack
- TypeScript + Node.js (ESM, `"type": "module"`)
- Anthropic SDK (`@anthropic-ai/sdk`) — primary agent runtime
- LangChain — used selectively for RAG/document utilities
- Redis — short-term agent memory
- PostgreSQL + pgvector — long-term semantic memory
- `tsx` — runs TypeScript directly (no build step needed for dev)

## Project Structure

```
agents/_base/     Base agent class and types
agents/<name>/    One folder per specialized agent
tools/            Reusable tool handlers (web search, code exec, memory)
memory/           Redis (short-term) and pgvector (long-term) adapters
workflows/        Multi-agent orchestration (sequential & parallel)
prompts/agents/   System prompts as versioned markdown files
evals/            Eval runner — runs against live models
scripts/          CLI helpers
config/           Env validation, model constants, logger
docs/             Architecture Decision Records (ADRs)
```

## Infrastructure

```bash
npm run infra:up       # start Redis + Postgres (pgvector) via Docker Compose
npm run infra:down     # stop containers
npm run infra:reset    # wipe volumes and restart
npm run infra:logs     # tail container logs
```

Postgres is initialized automatically with the `vector` extension and base tables via `infra/postgres/init.sql`.  
Default credentials (matching `.env.example`): `postgresql://ailab:ailab@localhost:5432/ai_lab`

## Running an agent

```bash
cp .env.example .env    # fill in ANTHROPIC_API_KEY
npm install
npm run infra:up
tsx scripts/run-agent.ts researcher "What is the state of AI agents in 2026?"
tsx scripts/run-agent.ts coder "Write a function to parse CSV files in TypeScript"
```

## Adding a new agent

1. Create `agents/<name>/agent.ts` — extend `BaseAgent`, implement `static async create()`
2. Create `prompts/agents/<name>.md` — the system prompt
3. Register tools via `agent.registerTool(...)` in `create()`
4. Export from `agents/<name>/agent.ts`

## Key conventions

- **Prompt caching**: always set `cache_control: { type: "ephemeral" }` on system prompt blocks
- **Tool handlers**: stateless functions in `tools/` — no agent state leaks into tools
- **Models**: always use `Models.default` / `Models.fast` / `Models.powerful` from `config/models.ts`
- **Env**: all env vars validated at startup via `config/env.ts` — never read `process.env` directly
- **Logging**: use `logger` from `config/logger.ts` — never `console.log` in agent/tool code
- **No build step**: use `tsx` for dev; `tsc` only to type-check (`npm run typecheck`)

## Decisions

See `docs/ADR-001-architecture.md` for architecture rationale.
---

# Cognitive Architecture Principles

## Tool-first execution

Always prioritize:
1. cache
2. retrieval
3. database
4. tools
5. APIs
6. reasoning

Reasoning should be the final step, not the first.

---

# Memory-aware agents

Agents must:
- retrieve semantic memory before reasoning
- avoid giant contexts
- compress historical context
- reuse previous knowledge
- operate with episodic memory

---

# Cost Optimization

Prefer:
- Haiku for lightweight tasks
- Sonnet for orchestration/coding
- Opus for planning/reflection

Avoid unnecessary expensive model calls.

---

# Multi-agent orchestration

Planner agents:
- decompose tasks
- generate DAGs
- select workflows

Orchestrator agents:
- coordinate execution
- manage retries
- aggregate outputs
- control state

Evaluator agents:
- run reflection loops
- critique outputs
- validate quality

---

# Observability

All agents should expose:
- token usage
- latency
- cost
- retrieval metrics
- tool usage
- workflow tracing

---

# Anti-patterns

Avoid:
- monolithic prompts
- agents without tools
- duplicated context
- recursive loops
- uncontrolled orchestration
- excessive reasoning

---

# Obsidian Integration

Obsidian vault acts as:
- long-term memory
- architectural memory
- semantic knowledge base
- operational cognition layer

All important architectural decisions should be documented and indexed.

---

# Engineering Philosophy

This workspace is designed as:
- AI-native infrastructure
- cognitive runtime
- orchestration platform
- multi-agent environment
- semantic operating system

Focus on:
- modularity
- scalability
- observability
- semantic memory
- orchestration
- retrieval quality
- low operational cost