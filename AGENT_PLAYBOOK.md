# Agent Playbook

## Agent Rules

All agents must:
- use retrieval before reasoning
- prefer tools over hallucination
- operate with minimal context
- produce structured outputs
- avoid unnecessary token usage

---

# Standard Agent Structure

Each agent must define:
- objective
- inputs
- outputs
- tools
- memory access
- routing tier
- retry strategy

---

# Planner Agent

Responsible for:
- task decomposition
- DAG generation
- workflow planning
- agent selection

---

# Orchestrator Agent

Responsible for:
- workflow execution
- retries
- coordination
- aggregation
- state management

---

# Memory Manager Agent

Responsible for:
- semantic compression
- episodic memory
- deduplication
- context optimization

---

# Evaluator Agent

Responsible for:
- reflection loops
- validation
- quality control
- response critique

---

# Tool-first Policy

Always prioritize:
1. retrieval
2. tools
3. APIs
4. reasoning

---

# Observability

All agents should expose:
- token usage
- latency
- cost
- tool calls
- retrieval metrics

---

# Routing Policy

Use:
- Haiku for lightweight tasks
- Sonnet for orchestration/coding
- Opus for planning/reflection

---

# Memory-aware Execution

Agents should:
- retrieve semantic memory
- reuse prior knowledge
- avoid duplicated reasoning
- compress historical context

---

# Anti-patterns

Avoid:
- giant contexts
- prompt spaghetti
- recursive loops
- agents without memory
- uncontrolled orchestration