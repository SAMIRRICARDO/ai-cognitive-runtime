# VRASHOWS Observability Architecture

## Overview

Observabilidade centralizada para monitorar saúde, performance e custo do VRASHOWS AI Runtime em produção.

---

## Observability Pillars

```
Observability
├─ Logs (what happened)
├─ Metrics (how much, how fast)
├─ Traces (how it happened, end-to-end)
└─ Alerts (when to act)
```

---

## Layer 1: Logs

### 1.1 Structured Logging

```typescript
// config/logger.ts
import winston from 'winston';

export const logger = winston.createLogger({
  format: winston.format.json(),
  defaultMeta: {
    service: 'vrashows',
    environment: process.env.NODE_ENV,
  },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

// Usage:
logger.info('Lead enriched', {
  leadId: '123',
  companyId: '456',
  enrichmentTime: 234, // ms
  costUSD: 0.05,
  tokenCount: 1024,
});
```

**Log Fields (required):**
```json
{
  "timestamp": "2026-05-19T12:34:56.000Z",
  "level": "info|warn|error",
  "message": "Lead enriched",
  "traceId": "abc-def-ghi", // correlation
  "service": "vrashows",
  "agent": "lead-enrichment",
  "operation": "enrich_lead",
  "duration": 234, // ms
  "status": "success|failure",
  "costUSD": 0.05,
  "tokenCount": 1024,
  "leadId": "123",
  "companyId": "456"
}
```

### 1.2 Log Levels & Routing

| Level | Purpose | Example |
|---|---|---|
| **DEBUG** | Development only | "Cache hit for key X" |
| **INFO** | Operational events | "Lead enriched successfully" |
| **WARN** | Degraded behavior | "High latency detected (500ms)" |
| **ERROR** | Failures | "API call failed (retry 1/3)" |
| **FATAL** | System down | "Database connection lost" |

**Routing:**
```
DEBUG → Local file only
INFO → Elasticsearch + file
WARN → Elasticsearch + Slack (#warnings)
ERROR → Elasticsearch + Slack (#errors) + PagerDuty
FATAL → Elasticsearch + Slack (#critical) + PagerDuty + Email
```

### 1.3 Log Retention

| Log Type | Retention | Storage |
|---|---|---|
| **Application logs** | 30 days | Elasticsearch |
| **API audit logs** | 90 days | PostgreSQL |
| **Cost logs** | 1 year | S3 (cold storage) |
| **Error logs** | 1 year | Elasticsearch |

---

## Layer 2: Metrics

### 2.1 Prometheus Metrics

```typescript
// config/metrics.ts
import promClient from 'prom-client';

// Counters
export const leadCounters = {
  acquired: new promClient.Counter({
    name: 'vrashows_leads_acquired_total',
    help: 'Total leads acquired',
    labelNames: ['source', 'status'],
  }),
  enriched: new promClient.Counter({
    name: 'vrashows_leads_enriched_total',
    help: 'Total leads enriched',
    labelNames: ['status'],
  }),
};

// Gauges
export const systemGauges = {
  queueDepth: new promClient.Gauge({
    name: 'vrashows_queue_depth',
    help: 'Current queue depth',
    labelNames: ['queue_type'],
  }),
  cacheHitRate: new promClient.Gauge({
    name: 'vrashows_cache_hit_rate',
    help: 'Cache hit rate (%)',
    labelNames: ['cache_level'],
  }),
};

// Histograms (latency)
export const latencyHistograms = {
  agentExecution: new promClient.Histogram({
    name: 'vrashows_agent_execution_seconds',
    help: 'Agent execution latency',
    labelNames: ['agent', 'status'],
    buckets: [0.1, 0.5, 1, 2, 5, 10],
  }),
  apiCall: new promClient.Histogram({
    name: 'vrashows_api_call_seconds',
    help: 'API call latency',
    labelNames: ['api', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1],
  }),
};

// Usage:
async function enrichLead(lead: Lead) {
  const startTime = Date.now();
  try {
    const enriched = await enrichmentAgent.execute(lead);
    leadCounters.enriched.labels('success').inc();
    latencyHistograms.agentExecution.labels('enrichment', 'success').observe((Date.now() - startTime) / 1000);
    return enriched;
  } catch (error) {
    leadCounters.enriched.labels('failure').inc();
    latencyHistograms.agentExecution.labels('enrichment', 'failure').observe((Date.now() - startTime) / 1000);
    throw error;
  }
}
```

### 2.2 Cost Metrics

```typescript
// config/cost-metrics.ts
export const costGauges = {
  dailySpend: new promClient.Gauge({
    name: 'vrashows_daily_spend_usd',
    help: 'Daily spending (USD)',
  }),
  agentCost: new promClient.Gauge({
    name: 'vrashows_agent_cost_usd',
    help: 'Cost per agent per day',
    labelNames: ['agent'],
  }),
  tokenCount: new promClient.Counter({
    name: 'vrashows_tokens_total',
    help: 'Total tokens consumed',
    labelNames: ['agent', 'model'],
  }),
};

// Emit cost metrics every minute
setInterval(async () => {
  const today = new Date().toISOString().split('T')[0];
  const dailyTotal = await redis.get(`cost:daily:${today}`);
  costGauges.dailySpend.set(parseFloat(dailyTotal || '0'));

  const agents = ['researcher', 'enricher', 'outreach'];
  for (const agent of agents) {
    const cost = await redis.get(`cost:agent:${agent}:${today}`);
    costGauges.agentCost.labels(agent).set(parseFloat(cost || '0'));
  }
}, 60000);
```

### 2.3 Dashboard (Grafana)

```
VRASHOWS Metrics Dashboard
═════════════════════════════════════════════════════════

📊 THROUGHPUT
  ├─ Leads/day:      450 ↗️
  ├─ Outreach/day:   180 →
  ├─ Emails sent:    165 ✅
  └─ Replies:        15 (9.1%)

⚡ LATENCY (p95)
  ├─ Enrichment:     2.3s 🟢
  ├─ Outreach gen:   1.8s 🟢
  ├─ Email send:     0.9s 🟢
  └─ Memory retrieval: 150ms 🟢

💰 COST
  ├─ Today:          $42.10 / $500
  ├─ Claude:         $28.50 (68%)
  ├─ OpenAI:         $12.30 (29%)
  └─ Resend:         $1.30 (3%)

📈 QUALITY
  ├─ Bounce rate:    2.3% 🟢
  ├─ Spam complain:  0.02% 🟢
  ├─ Delivery:       95.1% 🟢
  └─ Reply rate:     9.1% 🟡 (target 10%)

🖥️ INFRASTRUCTURE
  ├─ CPU util:       45% 🟢
  ├─ Memory:         68% 🟢
  ├─ Redis conn:     12/20 🟢
  └─ DB connections: 18/20 🟡
```

---

## Layer 3: Distributed Tracing

### 3.1 OpenTelemetry Setup

```typescript
// config/tracing.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { JaegerExporter } from '@opentelemetry/exporter-trace-jaeger';

const traceExporter = new JaegerExporter({
  endpoint: 'http://localhost:14250',
});

const sdk = new NodeSDK({
  traceExporter,
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

### 3.2 Instrumentation

```typescript
// agents/_base/agent.ts
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('vrashows-agent');

async function execute(input: string): Promise<string> {
  const span = tracer.startSpan('agent.execute', {
    attributes: {
      'agent.name': this.name,
      'agent.model': this.model,
    },
  });

  try {
    const toolSpan = tracer.startSpan('agent.tool_call', { parent: span });
    // ... tool execution ...
    toolSpan.end();

    return result;
  } finally {
    span.end();
  }
}
```

### 3.3 Trace Visualization (Jaeger)

```
Trace: Lead Enrichment Workflow (trace_id: abc-def-ghi)
═════════════════════════════════════════════════════════

coordinator.orchestrate           [████████████████] 2.34s
├─ researcher.execute              [████] 500ms
│  ├─ web_search.call             [██] 300ms
│  └─ memory.write                 [█] 150ms
├─ enricher.execute                [████████████] 1.2s
│  ├─ web_search.call             [███] 400ms
│  ├─ email_resolver.call         [████] 600ms
│  └─ memory.write                 [█] 150ms
└─ outreach.execute                [████] 640ms
   ├─ memory.read                  [█] 100ms
   ├─ claude.generate              [██████] 400ms
   └─ memory.write                 [█] 140ms

Total: 2.34s
Bottleneck: Enrichment (1.2s, 51%)
```

---

## Layer 4: Alerting

### 4.1 Alert Rules

```yaml
# alerts.yaml
groups:
- name: vrashows
  rules:
  - alert: HighCost
    expr: vrashows_daily_spend_usd > 500
    for: 5m
    labels:
      severity: critical
    annotations:
      summary: "Daily cost exceeded $500"

  - alert: HighLatency
    expr: vrashows_agent_execution_seconds{quantile="0.95"} > 5
    for: 10m
    labels:
      severity: warning
    annotations:
      summary: "Agent latency > 5s"

  - alert: HighBounceRate
    expr: vrashows_bounce_rate > 0.1
    for: 1h
    labels:
      severity: critical
    annotations:
      summary: "Bounce rate > 10%"

  - alert: QueueOverflow
    expr: vrashows_queue_depth > 10000
    for: 15m
    labels:
      severity: warning
    annotations:
      summary: "Queue depth > 10K"
```

### 4.2 Notification Channels

| Alert Level | Channels | Latency |
|---|---|---|
| **CRITICAL** | PagerDuty + Slack + Email | < 1 min |
| **WARNING** | Slack + Email | < 5 min |
| **INFO** | Slack (#metrics) | < 30 min |

---

## Dashboards & Views

### 5.1 Operations Dashboard

```
Real-time system health, SLA tracking, cost monitoring.
Audience: Ops, Leadership
Refresh: 1 minute
```

### 5.2 Engineer Dashboard

```
Agent performance, latency breakdown, queue depth, error rates.
Audience: Engineering
Refresh: 10 seconds
```

### 5.3 Cost Dashboard

```
Spending trends, per-agent costs, budget tracking, forecasting.
Audience: Finance, Leadership
Refresh: 1 hour
```

### 5.4 Customer Dashboard

```
Campaign metrics, delivery status, engagement, ROI.
Audience: Customer, Sales
Refresh: 1 hour
```

---

## Data Collection & Retention

| Signal | Source | Retention | Storage |
|---|---|---|---|
| **Logs** | Application | 30 days | Elasticsearch |
| **Metrics** | Prometheus | 15 days | Prometheus |
| **Traces** | Jaeger | 7 days | Jaeger backend |
| **Audit logs** | PostgreSQL | 1 year | PostgreSQL |
| **Cost data** | Redis → S3 | 1 year | S3 + Redshift |

---

## Health Checks

### 5.1 Liveness Check

```typescript
// Responds with 200 if service is running
GET /health/live
Response: { "status": "alive" }
```

### 5.2 Readiness Check

```typescript
// Responds with 200 if service is ready to handle requests
GET /health/ready
Response: {
  "status": "ready",
  "checks": {
    "redis": "healthy",
    "postgres": "healthy",
    "resend": "healthy"
  }
}
```

### 5.3 Startup Check

```typescript
// On startup, verify all dependencies
async function startupCheck() {
  const checks = [
    redis.ping(),
    postgres.query('SELECT 1'),
    resend.emails.list({ limit: 1 }),
  ];

  const results = await Promise.allSettled(checks);
  const failed = results.filter(r => r.status === 'rejected');

  if (failed.length > 0) {
    throw new Error(`Startup check failed: ${failed.length} dependencies`);
  }
}
```

---

## Observability Roadmap

| Phase | Timeline | Focus | Tools |
|---|---|---|---|
| **MVP** | May | Structured logs, basic metrics | Winston + Prometheus |
| **v1.0** | June | Distributed tracing, dashboards | Jaeger + Grafana |
| **v2.0** | Aug | SLO tracking, anomaly detection | Datadog/Splunk |
| **v3.0** | Q4 | ML-based alerting, forecasting | Custom ML models |

---

## Conclusion

Observabilidade é camada crítica para operação confiável. Implantar cedo; economiza 10x tempo de debugging em produção.

**Implementation Checklist:**
- [ ] Structured logging configured
- [ ] Prometheus metrics exported
- [ ] Jaeger tracing integrated
- [ ] Grafana dashboards created
- [ ] Alert rules tested
- [ ] On-call runbooks written
- [ ] Team trained on tooling
