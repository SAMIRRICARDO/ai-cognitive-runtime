# Current Operational Limitations

## Executive Summary

O VRASHOWS AI Runtime é uma plataforma enterprise-grade em fase de consolidação. Este documento mapeia claramente as limitações operacionais atuais versus o que é production-ready, permitindo decisões de escalabilidade informadas.

---

## Critical Path Limitations

### 1. Claude Code Session Context Saturation

**Issue:** Claude Code sessions têm limite de contexto compartilhado com o usuário.

- Limite atual: ~200K tokens por sessão
- Impacto: documentação longa causa context overflow
- Symptom: agent execution slows; recherche necessária
- Workaround: compartimentalizar prompts e usar memory-driven retrieval

**Mitigation:**
- Manter prompts < 10K tokens
- Usar semantic memory para contexto histórico
- Implementar cache de embedding para reutilização

**Status:** ⚠️ EARLY-STAGE — Requer otimização de prompt engineering

---

### 2. Sequential Outbound Bottleneck

**Issue:** `run-outbound-batch.ts` executa envios sequencialmente.

- Max throughput: ~50 leads/dia com delay 1200ms
- Bottleneck: Resend rate limits + sequential loop
- Impacto: não suporta campanhas de > 500 leads/dia

**Current Architecture:**
```
Load Queue → For-Loop (sequential) → sendEmail() → Resend API
```

**Limitation:**
- Sem parallelização nativa
- Sem backpressure handling
- Sem dead-letter fallback

**Status:** 🔴 BLOCKING — Requer reengenharia para escala

---

### 3. File-Based Queue System

**Issue:** Filas são materializadas em JSON (`data/outreach/*.json`).

- **Pros:** simplicidade, auditoria completa, sem dependências
- **Cons:** sem ordering garantido, sem ACK, sem retry nativo

**Limitations:**
- Sem exactly-once semantics
- Sem distribuição entre workers
- Sem transaction atomicity
- Perda de fila em crash sem backup

**Status:** ⚠️ MVP — Funcional para escala < 10K leads

---

### 4. Resend Dependency

**Issue:** 100% dependente de Resend para delivery.

**Risks:**
- Outage de Resend = pipeline paralisa
- Rate limits: máximo 100 emails/segundo
- Sem fallback provider (SendGrid, Mailgun)
- Sem retry automático em timeouts

**Current Behavior:**
```
sendEmail() → Resend API → Success/Failure
                              ↓
                          Error → Logged, não retryado
```

**Status:** 🔴 CRITICAL — Requer provider redundancy

---

### 5. Absence of Distributed Workers

**Issue:** Todos os agentes rodam no mesmo processo Node.js.

- Single-threaded (async only)
- Sem horizontal scaling
- Sem worker pools
- Sem job distribution

**Current Topology:**
```
Single Node.js Process
  ├─ Researcher Agent
  ├─ Enricher Agent
  ├─ Outreach Agent
  ├─ Email Sender
  └─ Memory Manager
```

**Limitation:**
- CPU-bound tasks block async loop
- Sem redundancy
- Sem fault isolation

**Status:** 🔴 EARLY-STAGE — Requer microservices/job queue

---

### 6. Redis Dependency (In-Memory Cache)

**Issue:** Redis é opcional mas crítico para performance.

- **Current:** Gracefully degrades, mas com 10x slowdown
- **Cache misses:** Sem memória de sessão = recompute
- **Deduplication:** Sem Redis = risk de duplicate sends

**Behavior:**
```
If Redis unavailable:
  - Cache → local in-memory (limited)
  - Dedup → file-based (slow)
  - Cost tracking → lost until Redis recovery
```

**Status:** ⚠️ PRODUCTION-READY — Requer HA setup (Redis Sentinel)

---

### 7. PostgreSQL + pgvector Scalability

**Issue:** Banco de dados centralizado sem sharding.

**Current Limits:**
- ~1M embeddings antes de latency degradation
- Sem índices HNSW otimizados
- Sem read replicas
- Sem connection pooling nativo

**Vector Search Performance:**
```
< 100K vectors: ~10ms (good)
100K-1M vectors: ~50-200ms (acceptable)
> 1M vectors: requires sharding
```

**Status:** ⚠️ MEDIUM-TERM — Escalável até 1M leads com tuning

---

### 8. Memory Injection Bottleneck

**Issue:** Contexto de memória injetado em cada prompt.

**Problem:**
- RAG retrieval: ~200-500ms por query
- Embedding lookup: ~50-100ms
- Context assembly: ~50-100ms
- **Total overhead:** 300-700ms por agent call

**Impact:** Latency cumulativo em chains com 5+ steps

**Status:** ⚠️ OPTIMIZATION-NEEDED — Requer caching estratégico

---

### 9. Observability Gap

**Issue:** Sem centralizado logging/monitoring.

**Current State:**
- Logs em JSON → arquivos (`logs/outreach/*.json`)
- Cost tracking → Redis (perdido sem snapshots)
- Metrics → ad-hoc via scripts
- Sem dashboards operacionais
- Sem alertas automáticos

**Status:** 🔴 CRITICAL — Requer Prometheus + Grafana

---

### 10. Cheap Mode Trade-offs

**Issue:** `CHEAP_MODE=true` reduz qualidade.

**Current Behavior:**
```
CHEAP_MODE=true:
  - Model: Haiku (fast, ~10x cheaper)
  - Tokens: cap 2048
  - Iterations: cap 5
  - Quality: 60-70% vs standard
```

**Risk:** Outreach de baixa qualidade → rejeição > 30%

**Status:** ⚠️ ACCEPTABLE — Apenas para MVP/experimentation

---

### 11. Context Trimming Limitations

**Issue:** Compressão de contexto é heurística.

**Problem:**
- Sem loss detection
- Sem relevance weighting
- Sem semantic similarity scoring

**Result:** Contexto comprimido pode perder sinais críticos

**Status:** ⚠️ IMPROVEMENT-NEEDED — Requer ML-based selection

---

### 12. No Distributed Tracing

**Issue:** Sem rastreamento end-to-end de requests.

**Current:**
- Logs separados por agente
- Sem correlation IDs
- Sem latency breakdown
- Difícil debugar fluxos complexos

**Status:** 🔴 NEEDED — Requer OpenTelemetry

---

## Capability Matrix

| Capability | Status | Limit | Roadmap |
|---|---|---|---|
| **Single agent execution** | ✅ Production | unlimited | — |
| **Parallel agent chains** | ⚠️ Limited | 4 concurrent | Q2 2026 |
| **Outbound rate** | ⚠️ Limited | 50/day | Q2 2026 |
| **Lead processing** | ✅ Good | 10K/day | — |
| **Memory retrieval** | ⚠️ Slow | 1M vectors | Q3 2026 |
| **Resend failover** | 🔴 None | — | Q2 2026 |
| **Distributed workers** | 🔴 None | — | Q3 2026 |
| **Real-time dashboards** | 🔴 None | — | Q3 2026 |
| **Cost governance** | ⚠️ Manual | reactive | Q2 2026 |
| **Queue persistence** | ⚠️ File-based | < 10K items | Q2 2026 |

---

## Impact on Scale

### Current Safe Envelope

```
Single deployment (1x Node.js process):
  - Leads: 0-10K/day
  - Outreach: 0-50/day
  - Memory: 0-100K vectors
  - Cost: $5-50/day
  - Reliability: 99% (single point of failure)
```

### Scaling Beyond Current Limits Requires

| Limit | Trigger | Action | ETA |
|---|---|---|---|
| > 50 outreach/day | throughput | Workers + Redis Streams | Q2 2026 |
| > 100K vectors | latency | pgvector sharding | Q3 2026 |
| > $100/day | costs | Model routing + cache | Q2 2026 |
| High availability | SLA | Redis HA + workers | Q3 2026 |
| Multi-tenant | business | Auth + isolation | Q4 2026 |

---

## Recommended Near-Term Hardening

### Phase 1: Stability (May 2026)

- [ ] Add Redis Sentinel for HA
- [ ] Implement retry logic in email sender
- [ ] Add centralized logging (ELK/Datadog)
- [ ] Document runbook for common failures

### Phase 2: Scale (June-July 2026)

- [ ] Migrate to Redis Streams for queueing
- [ ] Add distributed worker pool
- [ ] Implement Prometheus metrics
- [ ] Add email provider fallback (SendGrid)

### Phase 3: Enterprise (August-September 2026)

- [ ] pgvector sharding
- [ ] Multi-tenant architecture
- [ ] OpenTelemetry tracing
- [ ] SaaS-ready dashboards

---

## Conclusion

O VRASHOWS AI Runtime é **production-ready para workloads iniciais** (< 10K leads/day) mas requer evolução arquitetural clara para escala enterprise. Este documento serve como baseline para roadmap e decisões de investimento.

**Current Recommendation:** Use para MVP/early-stage; paralelize hardening roadmap.
