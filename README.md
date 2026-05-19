# AI Cognitive Runtime

> An AI-native orchestration platform for autonomous outbound operations — built on Claude (strategic layer), multi-agent pipelines, semantic memory, and a cost-governed delivery engine.

---

## Overview

This runtime is a production-grade, multi-agent system that automates the full lifecycle of B2B outbound operations:

```
Lead Acquisition → Validation → Enrichment → Outreach Generation → Delivery → Observability
```

It is designed to be modular, cost-aware, and extensible — operating as a cognitive layer on top of transactional infrastructure.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CLAUDE STRATEGIC LAYER                    │
│  Coordinator · Planner · Evaluator · Memory Manager         │
└───────────────────────┬─────────────────────────────────────┘
                        │ orchestrates
┌───────────────────────▼─────────────────────────────────────┐
│                   OPERATIONAL AGENTS                         │
│  Lead Sourcer · Validator · Enricher · Outreach Builder      │
│  Email Sender · Researcher · Vault Agent                     │
└───────────┬──────────────────────┬──────────────────────────┘
            │                      │
┌───────────▼──────────┐  ┌────────▼──────────────────────────┐
│    MEMORY LAYER      │  │         DELIVERY ENGINE            │
│  Redis (short-term)  │  │  Queue → Worker → Rate Limiter     │
│  pgvector (long-term)│  │  Scheduler → Failsafe → Report     │
│  Obsidian (semantic) │  └───────────────────────────────────┘
└──────────────────────┘
```

### Key subsystems

| Subsystem | Description |
|---|---|
| **Lead Acquisition** | Sourcer agents build company/contact lists from event seeds |
| **Validation Pipeline** | Scorer assigns strategic fit, seniority, and priority score |
| **Enrichment Agent** | Resolves email patterns (40+ company heuristics, 6 patterns) |
| **Outreach Builder** | Generates segment-personalized email copy via Claude |
| **Delivery Engine** | Queue-backed worker with rate limiting and dry-run mode |
| **Cheap Mode** | Haiku-first routing, token caps, iteration limits — 70% cost reduction |
| **Memory / RAG** | Redis short-term + pgvector long-term + Obsidian semantic vault |
| **Observability** | Structured logs, cost tracking, delivery reports, dashboard |

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | TypeScript + Node.js (ESM) |
| AI — Strategic | Anthropic Claude (Opus/Sonnet) |
| AI — Operational | Claude Haiku (cheap mode) |
| Embeddings | OpenAI `text-embedding-3-small` |
| Short-term memory | Redis |
| Long-term memory | PostgreSQL + pgvector |
| Semantic memory | Obsidian vault (markdown RAG) |
| Email delivery | Resend API |
| Web search | Tavily API |
| Infra | Docker Compose (Redis + Postgres) |

---

## Project Structure

```
agents/
  _base/          BaseAgent class — router, cache, context, cost tracking
  coordinator/    Orchestrator — decomposes tasks, coordinates agents
  coder/          Code generation and refactoring agent
  evaluator/      Reflection loops and output quality validation
  lead-sourcing/  Company/contact acquisition from event seeds
  lead-validation/Strategic scoring and segmentation
  lead-enrichment-agent/  Email pattern resolver + enrichment
  outreach-agent/ Segment-aware email generation (Claude)
  outreach-builder/ Queue entry builder and personalization
  email-sender-agent/ Delivery control and reporting
  futurecom-researcher/ Event-specific research agent
  memory-manager/ Memory ingestion and retrieval orchestration
  researcher/     General-purpose web research agent
  vault/          Obsidian vault RAG agent

config/
  env.ts          Startup env validation (zod) — never read process.env directly
  models.ts       Model constants + cheap mode token caps
  routing.ts      Model router — Haiku/Sonnet/Opus selection logic
  costs.ts        Per-call cost tracking and budget enforcement
  logger.ts       Structured logging (Winston)

memory/
  short-term/redis.ts     Redis adapter (conversation context, cache)
  long-term/pgvector.ts   Semantic vector search
  long-term/vault-index.ts  Obsidian vault indexer
  compressor.ts           Context compression to reduce token spend
  manager.ts              Unified memory interface

tools/
  send-email.ts   Resend integration with rate limiting and dry-run
  email-quality.ts Email quality scoring (syntax, pattern confidence)
  web-search.ts   Tavily search wrapper
  code-exec.ts    Sandboxed code execution tool

workers/
  delivery-worker.ts      Queue consumer for outbound email sends
  lead-validation-worker.ts  Async lead scoring processor

scheduler/
  outbound-scheduler.ts   Cron-based campaign scheduling with weekend/time guards

scripts/
  run-agent.ts            CLI entry point for any registered agent
  run-email.ts            Single email send (dev/test)
  run-outbound-batch.ts   Batch executor with dry-run, hot-only, preview modes
  generate-outreach-queue.ts  Build prioritized outreach queue from validated leads

workflows/
  sequential.ts   Sequential multi-agent workflow runner
  parallel.ts     Parallel workflow runner with aggregation

prompts/agents/   Versioned markdown system prompts (one per agent)
evals/            Eval runner against live models
infra/            Docker Compose, Postgres init SQL
data/examples/    Sanitized sample data for onboarding and testing
assets/templates/ Email template library (cold outreach, follow-up, executive)
docs/             Architecture, flows, enterprise guides
```

---

## Quick Start

### 1. Clone and install

```bash
git clone <repo-url>
cd ai-cognitive-runtime
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in: ANTHROPIC_API_KEY, RESEND_API_KEY, DATABASE_URL, REDIS_URL
```

### 3. Start infrastructure

```bash
npm run infra:up        # Redis + Postgres (Docker)
```

### 4. Run an agent

```bash
tsx scripts/run-agent.ts researcher "What is the state of AI agents in 2026?"
tsx scripts/run-agent.ts coder "Write a TypeScript CSV parser with zod validation"
```

### 5. Run outbound batch (dry-run)

```bash
tsx scripts/run-outbound-batch.ts \
  --queue data/outreach/queue.json \
  --dry-run
```

---

## Cheap Mode

Set `CHEAP_MODE=true` or `DEV_MODE=true` in `.env` to activate cost-reduced routing:

- All agents default to **Claude Haiku** instead of Sonnet/Opus
- `MAX_OUTPUT_TOKENS` capped at 2048
- `MAX_TOOL_ITERATIONS` capped at 5
- Skips pgvector and Redis if `ENABLE_MEMORY=false`

Estimated savings: **~70% vs full Opus routing**.

---

## Outbound Engine

The delivery system is a queue-backed pipeline with built-in safety controls:

```
Leads (validated JSON)
  → generate-outreach-queue  (prioritize: HOT > WARM > COLD)
    → delivery-worker         (rate limited, weekend-blocked)
      → send-email tool        (Resend API, dry-run supported)
        → delivery report       (per-run JSON artifact)
```

### Safety flags

| Flag | Default | Description |
|---|---|---|
| `--dry-run` | on | Preview emails without sending |
| `--live` | off | Actually send (requires explicit flag) |
| `--limit N` | unlimited | Cap sends per session |
| `--hot-only` | off | Send only highest-priority leads |
| `MAX_SENDS_PER_DAY` | 5 | Hard daily cap (env) |
| `NO_SEND_AFTER` | 16:00 | Time-of-day guard |
| `WEEKEND_BLOCK` | true | Block Saturday/Sunday sends |

---

## Memory Architecture

```
Input → [Short-term Redis cache] → [Semantic pgvector search] → [Obsidian RAG]
                                                          ↓
                                              Context injected to agent
                                                          ↓
                                          Agent response → [Memory compressor]
                                                          ↓
                                               Stored back to pgvector
```

- **Redis**: conversation context, response cache (TTL-based)
- **pgvector**: semantic embeddings for long-term memory retrieval
- **Obsidian vault**: architectural decisions, campaign learnings, entity notes

---

## Cost Architecture

The runtime implements a 4-layer cost governance model:

1. **Model routing** — Haiku for lightweight tasks, Sonnet for orchestration, Opus for planning
2. **Token caps** — per-agent max_tokens, global MAX_OUTPUT_TOKENS
3. **Iteration caps** — MAX_TOOL_ITERATIONS prevents runaway loops
4. **Budget enforcement** — per-call cost recorded, daily/monthly budget alerts

Target: **< $0.05 per enriched lead** in cheap mode.

See [`docs/COST_GOVERNANCE.md`](docs/COST_GOVERNANCE.md) for full breakdown.

---

## Observability

All agents emit structured logs and cost events:

```
{
  "level": "info",
  "agent": "outreach-agent",
  "model": "claude-haiku-4-5",
  "tokens": { "input": 1240, "output": 380 },
  "cost_usd": 0.00031,
  "latency_ms": 1820,
  "tool_calls": 2
}
```

Dashboard available at `dashboard/index.html` (serve locally via `node dashboard/server.js`).

---

## Infrastructure

```bash
npm run infra:up       # start Redis + Postgres
npm run infra:down     # stop containers
npm run infra:reset    # wipe volumes and restart
npm run infra:logs     # tail container logs
```

Postgres is auto-initialized with the `vector` extension via `infra/postgres/init.sql`.

Default credentials (`.env.example`): `postgresql://ailab:ailab@localhost:5433/ai_lab`

---

## Adding a New Agent

1. Create `agents/<name>/agent.ts` — extend `BaseAgent`, implement `static async create()`
2. Create `prompts/agents/<name>.md` — the system prompt (versioned markdown)
3. Register tools via `agent.registerTool(...)` in `create()`
4. Register in `agents/registry.ts`

Key conventions:
- Always set `cache_control: { type: "ephemeral" }` on system prompt blocks
- Use `Models.default` / `Models.fast` / `Models.powerful` from `config/models.ts`
- Use `logger` from `config/logger.ts` — never `console.log`
- All env vars via `config/env.ts` — never read `process.env` directly

---

## Documentation

| Document | Audience | Description |
|---|---|---|
| [`docs/architecture/VRASHOWS_AI_Runtime_Architecture.md`](docs/architecture/VRASHOWS_AI_Runtime_Architecture.md) | Engineers | Full architecture with Mermaid diagrams |
| [`docs/architecture/queue-flow.md`](docs/architecture/queue-flow.md) | Backend | Queue, workers, batching, retry strategy |
| [`docs/architecture/memory-flow.md`](docs/architecture/memory-flow.md) | AI Engineers | RAG, memory injection, context trimming |
| [`docs/architecture/delivery-flow.md`](docs/architecture/delivery-flow.md) | Backend | Email delivery pipeline, BCC, bounce protection |
| [`docs/COST_GOVERNANCE.md`](docs/COST_GOVERNANCE.md) | Finance / Engineering | Budget enforcement, per-agent costs |
| [`docs/SCALING_STRATEGY.md`](docs/SCALING_STRATEGY.md) | Architects | Phase-by-phase scaling from 50 to 10K+ leads/day |
| [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) | DevOps | Logs, metrics, tracing, alerting |
| [`docs/FAILSAFE_SYSTEMS.md`](docs/FAILSAFE_SYSTEMS.md) | Engineers | Circuit breakers, retry, dead-letter queues |
| [`docs/SYSTEM_GUARDRAILS.md`](docs/SYSTEM_GUARDRAILS.md) | Engineers | Token caps, cost caps, iteration limits |
| [`docs/PRODUCTION_ROADMAP.md`](docs/PRODUCTION_ROADMAP.md) | Product | Phase 0–5 roadmap (12+ months) |
| [`docs/OUTBOUND_METRICS.md`](docs/OUTBOUND_METRICS.md) | Operations | SLAs, KPIs, outbound warming strategy |
| [`docs/AI_PROVIDER_STRATEGY.md`](docs/AI_PROVIDER_STRATEGY.md) | Engineering | Provider selection matrix, fallback strategy |
| [`SECURITY.md`](SECURITY.md) | Everyone | Data handling, secret management, safe deployment |
| [`AGENT_PLAYBOOK.md`](AGENT_PLAYBOOK.md) | Engineers | Agent development guide and conventions |

---

## License

Private — internal use only. Not for redistribution.
