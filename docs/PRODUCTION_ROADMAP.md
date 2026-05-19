# VRASHOWS Production Roadmap

## Overview

Roadmap técnico alinhado para transformar o VRASHOWS AI Runtime de MVP para plataforma enterprise scalável, preparada para multi-cliente, observabilidade centralizada e operação contínua.

---

## Phase 0: Current State (May 2026)

**Status:** ✅ Production MVP

### What Works
- Single-node agent orchestration
- Claude strategic layer
- Lead enrichment workflow
- Email delivery via Resend
- File-based queue system
- Basic Redis caching
- PostgreSQL + pgvector memory

### What's Missing
- Distributed execution
- Real-time observability
- Provider redundancy
- Cost governance
- Multi-tenant architecture
- Automated scaling

---

## Phase 1: Foundation Hardening (May-June 2026)

**Goal:** Stabilize MVP, add safety rails, centralize observability.

### 1.1 Centralized Logging & Metrics

**Priority:** 🔴 CRITICAL
**Effort:** Medium (2 weeks)
**Cost:** $50-100/month (ELK/Datadog)

**Deliverables:**
- [ ] ELK Stack (Elasticsearch + Logstash + Kibana) OR Datadog agent
- [ ] Prometheus metrics export from agents
- [ ] Cost tracking dashboard (tokens/day, $/day by agent)
- [ ] Queue monitoring dashboard
- [ ] Email delivery metrics (sent, bounced, replied, failed)

**Impact:**
- Visibility into system behavior
- Early warning for runaway execution
- Cost accountability

**Owner:** DevOps / Platform

---

### 1.2 Emergency Safeguards

**Priority:** 🔴 CRITICAL
**Effort:** Small (1 week)
**Cost:** $0 (internal)

**Deliverables:**
- [ ] Token explosion circuit breaker (max 50K/request)
- [ ] Daily cost cap ($500)
- [ ] Iteration cap (max 10 loops per agent)
- [ ] Queue overflow protection (max 10K pending)
- [ ] Email rate cap (max 100/hour)

**Code Changes:**
```typescript
// config/guardrails.ts
export const GUARDRAILS = {
  maxTokensPerRequest: 50000,
  maxDailyCostUSD: 500,
  maxIterationsPerAgent: 10,
  maxQueueSize: 10000,
  maxEmailsPerHour: 100,
};

// agents/_base/agent.ts
if (totalTokensUsed > GUARDRAILS.maxTokensPerRequest) {
  throw new Error('Token explosion detected');
}
```

**Impact:**
- Prevent runaway costs
- Prevent system overload

**Owner:** Engineering

---

### 1.3 Redis HA Setup

**Priority:** 🔴 HIGH
**Effort:** Small (3 days)
**Cost:** $0 (infra already supports Redis Sentinel)

**Deliverables:**
- [ ] Redis Sentinel configuration (3 nodes)
- [ ] Automatic failover setup
- [ ] Health check monitoring
- [ ] Backup snapshots (daily)

**Impact:**
- 99.9% availability for cache
- Data persistence
- Automatic recovery

**Owner:** DevOps

---

### 1.4 Retry Logic & Graceful Degradation

**Priority:** 🟡 HIGH
**Effort:** Medium (1 week)
**Cost:** $0

**Deliverables:**
- [ ] Exponential backoff for Resend failures
- [ ] Dead-letter queue for failed sends
- [ ] Graceful degradation when Redis unavailable
- [ ] Fallback to file-based dedup
- [ ] Manual replay mechanism

**Owner:** Engineering

---

## Phase 2: Queue & Concurrency (June-July 2026)

**Goal:** Enable parallel execution, increase outbound throughput 10x.

### 2.1 Redis Streams Queue

**Priority:** 🔴 CRITICAL
**Effort:** Large (3 weeks)
**Cost:** $0 (uses existing Redis)

**Current State:**
```
Lead Queue (JSON file) → For-loop → sendEmail()
                           ↓
                      Sequential (1 at a time)
                      Max: 50/day
```

**Target State:**
```
Lead Queue (Redis Stream)
  ├→ Worker 1: send email
  ├→ Worker 2: send email
  ├→ Worker 3: send email
  └→ Worker 4: send email
      ↓
  Parallel (4 concurrent)
  Max: 500/day
```

**Deliverables:**
- [ ] Migrate file queues to Redis Streams
- [ ] Implement consumer groups for workers
- [ ] Add acknowledgment mechanism (ACK)
- [ ] Dead-letter queue for failures
- [ ] Queue monitoring metrics

**API Changes:**
```typescript
// From:
const queue = JSON.parse(fs.readFileSync('data/outreach/leads.json'));
for (const lead of queue) {
  await sendEmail(lead);
}

// To:
const stream = await redis.xreadgroup('outreach-group', 'worker-1');
for (const [id, fields] of stream) {
  await sendEmail(fields);
  await redis.xack('outreach', 'outreach-group', id);
}
```

**Impact:**
- 10x throughput increase
- Parallel processing
- Built-in failure handling

**Owner:** Engineering

---

### 2.2 Distributed Worker Pool

**Priority:** 🟡 HIGH
**Effort:** Large (4 weeks)
**Cost:** $200-500/month (worker VMs)

**Architecture:**
```
Master (orchestration)
  ├→ Worker 1 (email sender)
  ├→ Worker 2 (enrichment)
  ├→ Worker 3 (validation)
  └→ Worker 4 (analytics)
      ↓
  Shared Redis (queues + cache)
  Shared PostgreSQL (memory)
```

**Deliverables:**
- [ ] Docker containerization
- [ ] Kubernetes manifests (or Docker Compose for local)
- [ ] Worker health checks
- [ ] Graceful shutdown handling
- [ ] Horizontal scaling scripts

**Impact:**
- Fault isolation
- Horizontal scaling
- Load balancing

**Owner:** DevOps / Engineering

---

### 2.3 Email Provider Redundancy

**Priority:** 🟡 HIGH
**Effort:** Medium (2 weeks)
**Cost:** $0 (duplicate API costs if used)

**Current:** 100% Resend

**Target:**
```
Primary: Resend
Fallback: SendGrid
Fallback: Mailgun

Failover logic:
  Try Resend → if timeout/error → SendGrid → Mailgun
```

**Deliverables:**
- [ ] Implement provider abstraction
- [ ] Add SendGrid + Mailgun clients
- [ ] Automatic failover logic
- [ ] Provider health monitoring
- [ ] Cost split tracking

**Owner:** Engineering

---

## Phase 3: Enterprise Scale (August-September 2026)

**Goal:** Support 100K+ leads, multi-tenant, enterprise SLAs.

### 3.1 pgvector Sharding

**Priority:** 🟡 HIGH
**Effort:** Large (4 weeks)
**Cost:** $500-1K/month (additional DB instances)

**Current:** Single PostgreSQL instance

**Target:**
```
Vector Shard 1 (0-250K vectors)
Vector Shard 2 (250K-500K)
Vector Shard 3 (500K-750K)
Vector Shard 4 (750K-1M+)
  ↓
Router layer (hashes lead_id → shard)
```

**Deliverables:**
- [ ] Shard topology design
- [ ] Range-based partitioning
- [ ] Router implementation
- [ ] Rebalancing scripts
- [ ] Cross-shard aggregation

**Impact:**
- Support 1M+ vectors
- Sub-100ms retrieval
- Horizontal scaling

**Owner:** Data Platform

---

### 3.2 OpenTelemetry Tracing

**Priority:** 🟡 MEDIUM
**Effort:** Medium (2 weeks)
**Cost:** $100-200/month (Jaeger or Datadog APM)

**Current State:**
```
Agent A → Agent B → Tool X
  ↓
Separate logs (no correlation)
```

**Target State:**
```
Agent A → Agent B → Tool X
  ↓
Single trace (correlated, end-to-end timing)
```

**Deliverables:**
- [ ] OpenTelemetry SDK integration
- [ ] Trace instrumentation for agents
- [ ] Span exporters
- [ ] Jaeger/Datadog backend setup
- [ ] Trace visualization dashboards

**Impact:**
- End-to-end visibility
- Latency breakdown
- Bottleneck identification

**Owner:** DevOps / Platform

---

### 3.3 Multi-Tenant Architecture

**Priority:** 🟡 MEDIUM
**Effort:** Very Large (6-8 weeks)
**Cost:** $1K+/month (infrastructure + tooling)

**Current:** Single-tenant, single company

**Target:**
```
Tenant A
  ├─ Company data (isolated)
  ├─ Queue (isolated)
  ├─ API keys (tenant-specific)
  └─ Billing (per-tenant)

Tenant B
  ├─ Company data (isolated)
  ├─ Queue (isolated)
  └─ ...

Shared Infrastructure:
  ├─ Redis (multi-tenant namespacing)
  ├─ PostgreSQL (row-level security)
  └─ API (tenant routing)
```

**Deliverables:**
- [ ] Tenant isolation layer
- [ ] Row-level security (RLS) in PostgreSQL
- [ ] Namespace isolation in Redis
- [ ] API authentication (JWT + tenant ID)
- [ ] Billing system integration
- [ ] Tenant-scoped dashboards

**Impact:**
- SaaS-ready platform
- Multi-company support
- Revenue generation path

**Owner:** Platform / Product

---

### 3.4 Advanced Cost Governance

**Priority:** 🟡 MEDIUM
**Effort:** Medium (2 weeks)
**Cost:** $0 (internal)

**Current:** Manual cheap mode toggle

**Target:**
```
AI Provider Cost Management:
  - Per-tenant budgets
  - Per-agent budgets
  - Real-time cost tracking
  - Automatic model downgrade
  - Budget alerts
  - Monthly cap enforcement
```

**Deliverables:**
- [ ] Cost budgeting system
- [ ] Per-agent cost tracking
- [ ] Automatic model routing
- [ ] Budget enforcement (block overage)
- [ ] Cost reporting APIs

**Owner:** Finance / Engineering

---

## Phase 4: Intelligence & Automation (October-November 2026)

**Goal:** AI-driven optimization, autonomous operations.

### 4.1 Automated Lead Scoring ML

**Priority:** 🟢 MEDIUM
**Effort:** Large (4 weeks)
**Cost:** $500-1K/month (ML infra)

**Current:** Heuristic-based scoring

**Target:**
```
Train ML model on historical data:
  - inputs: company data, contact info, engagement history
  - output: probability of positive reply
  - feedback: actual replies (train weekly)
```

**Impact:**
- Higher quality leads
- Reduced bounce rate
- Better ROI

**Owner:** Data Science

---

### 4.2 Reply Tracking & Inbox Monitoring

**Priority:** 🟢 MEDIUM
**Effort:** Large (3 weeks)
**Cost:** $200-500/month (email API enhancements)

**Deliverables:**
- [ ] Webhook integration for reply detection
- [ ] IMAP/Exchange integration for inbox monitoring
- [ ] Sentiment analysis on replies
- [ ] Automatic follow-up triggering
- [ ] Reply feedback loop

**Impact:**
- Visibility into campaign effectiveness
- Automated follow-ups
- AI-driven personalization refinement

**Owner:** Engineering / Product

---

### 4.3 CRM Integration

**Priority:** 🟢 LOW
**Effort:** Medium (2 weeks per CRM)
**Cost:** $0 (using existing APIs)

**Supported CRMs:**
- Salesforce
- HubSpot
- Pipedrive
- Custom webhooks

**Deliverables:**
- [ ] Bidirectional sync (leads ↔ CRM)
- [ ] Opportunity creation
- [ ] Activity logging
- [ ] Deal stage automation

**Impact:**
- Closed-loop outreach
- Revenue attribution
- Sales integration

**Owner:** Product / Integration

---

## Phase 5: ML & Personalization (Q1 2027)

**Goal:** AI-driven personalization at scale.

### 5.1 Dynamic Outreach Personalization

**Priority:** 🟢 LOW
**Effort:** Very Large (6-8 weeks)
**Cost:** High (Claude Opus calls per lead)

**Current:** Template-based with basic variable substitution

**Target:**
```
For each lead:
  1. Retrieve: company data, recent news, LinkedIn profile
  2. Claude analyzes: pain points, buying signals, decision makers
  3. Generate: 100% personalized email (not template)
  4. Track: opens, clicks, replies
  5. Iterate: improve prompt based on feedback
```

**Impact:**
- 3-5x higher reply rates
- Premium positioning
- Executive-level engagement

**Owner:** Product / AI

---

## Timeline Summary

```
May 2026:     ████  Phase 1: Foundation (logging, guardrails, HA)
June 2026:    ████████  Phase 2: Queue & Concurrency (Redis, workers)
July 2026:    ████  Phase 2: Email redundancy
Aug 2026:     ████████  Phase 3: Enterprise (pgvector, multi-tenant)
Sept 2026:    ████  Phase 3: Observability (OTEL)
Oct-Nov 2026: ████████  Phase 4: Intelligence (ML, CRM)
Q1 2027:      ████████████  Phase 5: Advanced Personalization
```

---

## Investment Summary

| Phase | Timeline | Effort | Cost | Impact |
|---|---|---|---|---|
| **Phase 1** | May-June | 3 weeks | $50-150/mo | Stability |
| **Phase 2** | June-July | 7 weeks | $200-500/mo | 10x throughput |
| **Phase 3** | Aug-Sept | 10 weeks | $600-1.2K/mo | Enterprise scale |
| **Phase 4** | Oct-Nov | 8 weeks | $500-1.5K/mo | Intelligence |
| **Phase 5** | Q1 2027 | 8+ weeks | $2K+/mo | Premium position |

**Total Year 1:** ~$20-30K (fully loaded)
**Headcount:** 1 DevOps + 2 Engineers + 1 Data Scientist

---

## Success Metrics

### Phase 1
- [ ] Cost visibility (100% of spending tracked)
- [ ] 0 runaway executions
- [ ] 99% system uptime

### Phase 2
- [ ] 500+ leads/day throughput
- [ ] 4 concurrent workers
- [ ] Provider fallback working

### Phase 3
- [ ] 100K+ leads in system
- [ ] < 100ms vector search
- [ ] 2+ tenants in beta

### Phase 4
- [ ] 30%+ reply rate improvement
- [ ] Closed-loop attribution
- [ ] CRM integration live

### Phase 5
- [ ] 50%+ reply rate (vs baseline)
- [ ] $10K+ MRR pipeline
- [ ] Production multi-tenant SaaS

---

## Conclusion

Roadmap de 12+ meses transformando VRASHOWS de MVP para plataforma enterprise-grade. Prioridades: **observabilidade → escalabilidade → inteligência → monetização**.

**Next Step:** Aprovar Phase 1 (Foundation) e alocar recursos.
