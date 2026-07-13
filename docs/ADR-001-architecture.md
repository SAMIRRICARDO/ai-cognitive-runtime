# ADR-001: AI Agent Workspace Architecture

**Date:** 2026-05-18  
**Status:** Accepted

## Context

We need a professional workspace to develop, test, and orchestrate AI agents using Anthropic's Claude models, with support for tool use, persistent memory, and multi-agent workflows.

## Decisions

### 1. Anthropic SDK as the primary agent runtime
We use `@anthropic-ai/sdk` directly (not a framework abstraction) for full control over tool use, prompt caching, and streaming. LangChain is used selectively for RAG and document processing utilities.

### 2. Prompt caching on all system prompts
Every agent sets `cache_control: { type: "ephemeral" }` on its system prompt. This reduces costs by ~90% on repeated calls and latency by ~85% after the first call.

### 3. BaseAgent with agentic loop
A single `BaseAgent` class handles the tool-use agentic loop (up to `maxIterations`). Each specialized agent extends it and registers its tools, keeping agent logic isolated from infrastructure.

### 4. Redis for short-term / pgvector for long-term memory
- Redis: fast key-value store for session context, intermediate results, and rate-limiting state.
- pgvector: semantic similarity search over a persistent document corpus for long-term recall.

### 5. Prompts as versioned markdown files
System prompts live in `prompts/agents/*.md` and are loaded at runtime. This allows prompt iteration without touching TypeScript code and makes diffs readable.

### 6. Sequential + parallel orchestrators
`workflows/orchestrator.ts` provides two primitives: `runSequential` (pipelines) and `runParallel` (fan-out). Complex workflows compose these two patterns.

## Consequences

- Adding a new agent = one file in `agents/<name>/agent.ts` + one prompt in `prompts/agents/<name>.md`
- Tools are stateless functions registered per-agent — easy to unit test in isolation
- Evals run against live models (not mocks) to catch real regressions
