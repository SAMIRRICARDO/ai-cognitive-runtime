# Agent Patterns

## Objective

Definir padrões arquiteturais para construção de sistemas multiagentes escaláveis,
econômicos e orientados a ferramentas.

---

# Planner Agents

## Responsabilidade
- decompor objetivos complexos
- gerar planos executáveis
- definir subtarefas
- escolher agentes especializados
- reduzir custo cognitivo

## Regras
- nunca executar tarefas diretamente
- atuar apenas como coordenador
- minimizar chamadas de modelos caros
- preferir reasoning curto + tool delegation

## Fluxo
User Goal
↓
Planner
↓
Task Graph
↓
Specialized Agents
↓
Aggregation

## Exemplos
- decomposição de projetos
- planejamento de automações
- divisão de workflows longos

---

# Orchestrators

## Responsabilidade
- coordenar múltiplos agentes
- controlar estado do workflow
- gerenciar retries
- controlar contexto
- consolidar outputs

## Padrões
- sequential workflows
- parallel fan-out
- reflection loops
- evaluator pattern
- planner-executor architecture

## Regras
- evitar contexto gigante
- repassar apenas contexto relevante
- usar memória semântica
- priorizar tools antes de LLM

---

# Memory Systems

## Tipos de memória

### Working Memory
Redis
TTL curto
Contexto ativo da sessão

### Long-Term Memory
PostgreSQL
Dados persistentes
Histórico de agentes

### Semantic Memory
pgvector
Embeddings
Busca contextual

### Episodic Memory
Resumos de execuções anteriores
Aprendizados
Decisões

---

# Tool Routing

## Filosofia
Tool-first architecture

## Ordem de execução
1. cache
2. retrieval
3. tools
4. LLM
5. expensive reasoning

## Regras
- evitar usar LLM para tarefas determinísticas
- usar SQL em vez de perguntar ao modelo
- usar APIs antes de reasoning
- usar embeddings antes de contexto gigante

---

# MCP Architecture

## Objetivo
Padronizar acesso a ferramentas externas.

## MCPs planejados
- filesystem
- PostgreSQL
- Redis
- browser
- HTTP
- Obsidian
- GitHub
- Docker

## Fluxo
Agent
↓
MCP Router
↓
External Tool
↓
Structured Result
↓
LLM Synthesis

---

# Cost Optimization

## Estratégias

### Model Routing
- Haiku → tarefas simples
- Sonnet → reasoning médio
- Opus → planejamento complexo

### Prompt Caching
- cache de system prompts
- cache Redis
- cache de embeddings

### Context Compression
- resumir histórico antigo
- semantic chunking
- retrieval seletivo

### Retrieval
- hybrid search
- semantic + keyword + recency
- top-k pequeno

### Regras
- minimizar tokens
- evitar contexto desnecessário
- usar ferramentas primeiro
- limitar loops agenticos

---

# Engineering Principles

## Core Principles
- modularidade
- observabilidade
- baixo custo
- memory-aware
- tool-first
- orchestration-first

## Anti-patterns
- contexto gigante
- agentes sem ferramentas
- loops infinitos
- prompts monolíticos
- múltiplos modelos sem routing

---

# Future Architecture

## Próximos componentes
- memory-manager-agent
- planner-agent
- orchestrator-agent
- evaluator-agent
- reflection-agent

## Objetivo final
Construir um AI Cognitive Operating System.# Agent Patterns

## Objective

Definir padrões arquiteturais para construção de sistemas multiagentes escaláveis,
econômicos e orientados a ferramentas.

---

# Planner Agents

## Responsabilidade
- decompor objetivos complexos
- gerar planos executáveis
- definir subtarefas
- escolher agentes especializados
- reduzir custo cognitivo

## Regras
- nunca executar tarefas diretamente
- atuar apenas como coordenador
- minimizar chamadas de modelos caros
- preferir reasoning curto + tool delegation

## Fluxo
User Goal
↓
Planner
↓
Task Graph
↓
Specialized Agents
↓
Aggregation

## Exemplos
- decomposição de projetos
- planejamento de automações
- divisão de workflows longos

---

# Orchestrators

## Responsabilidade
- coordenar múltiplos agentes
- controlar estado do workflow
- gerenciar retries
- controlar contexto
- consolidar outputs

## Padrões
- sequential workflows
- parallel fan-out
- reflection loops
- evaluator pattern
- planner-executor architecture

## Regras
- evitar contexto gigante
- repassar apenas contexto relevante
- usar memória semântica
- priorizar tools antes de LLM

---

# Memory Systems

## Tipos de memória

### Working Memory
Redis
TTL curto
Contexto ativo da sessão

### Long-Term Memory
PostgreSQL
Dados persistentes
Histórico de agentes

### Semantic Memory
pgvector
Embeddings
Busca contextual

### Episodic Memory
Resumos de execuções anteriores
Aprendizados
Decisões

---

# Tool Routing

## Filosofia
Tool-first architecture

## Ordem de execução
1. cache
2. retrieval
3. tools
4. LLM
5. expensive reasoning

## Regras
- evitar usar LLM para tarefas determinísticas
- usar SQL em vez de perguntar ao modelo
- usar APIs antes de reasoning
- usar embeddings antes de contexto gigante

---

# MCP Architecture

## Objetivo
Padronizar acesso a ferramentas externas.

## MCPs planejados
- filesystem
- PostgreSQL
- Redis
- browser
- HTTP
- Obsidian
- GitHub
- Docker

## Fluxo
Agent
↓
MCP Router
↓
External Tool
↓
Structured Result
↓
LLM Synthesis

---

# Cost Optimization

## Estratégias

### Model Routing
- Haiku → tarefas simples
- Sonnet → reasoning médio
- Opus → planejamento complexo

### Prompt Caching
- cache de system prompts
- cache Redis
- cache de embeddings

### Context Compression
- resumir histórico antigo
- semantic chunking
- retrieval seletivo

### Retrieval
- hybrid search
- semantic + keyword + recency
- top-k pequeno

### Regras
- minimizar tokens
- evitar contexto desnecessário
- usar ferramentas primeiro
- limitar loops agenticos

---

# Engineering Principles

## Core Principles
- modularidade
- observabilidade
- baixo custo
- memory-aware
- tool-first
- orchestration-first

## Anti-patterns
- contexto gigante
- agentes sem ferramentas
- loops infinitos
- prompts monolíticos
- múltiplos modelos sem routing

---

# Future Architecture

## Próximos componentes
- memory-manager-agent
- planner-agent
- orchestrator-agent
- evaluator-agent
- reflection-agent

## Objetivo final
Construir um AI Cognitive Operating System.
