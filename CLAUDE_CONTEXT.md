# AI Cognitive Runtime Context

## System Identity

AI-native cognitive runtime focused on:
- multi-agent systems
- orchestration
- semantic memory
- tool-first execution
- cost optimization
- retrieval-augmented generation
- cognitive workflows

---

# Architectural Philosophy

- retrieval before generation
- tools before reasoning
- memory-aware execution
- modular agents only
- avoid giant contexts
- semantic retrieval first
- structured outputs
- orchestration over monolithic prompts

---

# Model Routing

## Haiku
Use for:
- retrieval
- classification
- summaries
- lightweight reasoning

## Sonnet
Use for:
- orchestration
- coding
- medium reasoning
- workflows

## Opus
Use for:
- planning
- evaluator loops
- reflection
- complex decisions

---

# Memory Architecture

## Redis
Short-term working memory.

## PostgreSQL
Persistent operational memory.

## pgvector
Semantic retrieval and vector search.

## Obsidian Vault
Long-term cognitive memory.

---

# Tool-first Execution

Execution priority:
1. cache
2. retrieval
3. database
4. tools
5. APIs
6. reasoning

---

# Anti-patterns

Avoid:
- giant prompts
- infinite loops
- agents without tools
- duplicated context
- unnecessary reasoning
- monolithic agents

---

# Engineering Standards

- modular architecture
- observability
- cost tracking
- structured logging
- semantic memory
- incremental indexing
- retrieval optimization

---

# Current Stack

- Claude API
- OpenAI Embeddings
- PostgreSQL
- pgvector
- Redis
- LangGraph
- Obsidian
- Docker Compose

---

# Long-term Goal

Build scalable AI-native systems with:
- orchestration
- memory
- semantic retrieval
- autonomous workflows
- MCP integrations
- cognitive infrastructure