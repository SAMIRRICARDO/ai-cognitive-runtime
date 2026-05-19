# VRASHOWS Scaling Strategy

## Overview

Arquitetura e padrões para escalar o VRASHOWS AI Runtime de 50 leads/dia para 10K+ leads/dia mantendo performance, confiabilidade e custo efetivo.

---

## Current Bottlenecks & Solutions

| Bottleneck | Current Limit | Solution | Target |
|---|---|---|---|
| **Sequential outbound** | 50/day | Redis Streams + workers | 500/day |
| **Single node CPU** | ~2 cores utilized | Horizontal scaling | 8+ cores distributed |
| **Vector search latency** | 200-500ms | pgvector sharding | 50-100ms |
| **Memory injection** | 2KB context | Intelligent filtering | 1KB relevant |
| **API parallelization** | 1 at a time | Rate-limited batches | 10 parallel |
| **Cost per lead** | $0.10 | Cheap mode + caching | $0.01 |

---

## Phase 1: Horizontal Worker Scaling

### 1.1 Architecture

```
Master Orchestrator
  ├─ Task Scheduler (Redis)
  ├─ State Manager (PostgreSQL)
  └─ Metrics Collector (Prometheus)

Workers (horizontal scaling)
  ├─ Worker 1 (enrichment)
  ├─ Worker 2 (enrichment)
  ├─ Worker 3 (outreach)
  ├─ Worker 4 (email send)
  └─ Worker 5 (email send)

Shared Infrastructure
  ├─ Redis (state + queue)
  ├─ PostgreSQL (memory + metrics)
  └─ Resend (email delivery)
```

---

### 1.2 Worker Pool Configuration

```typescript
// config/worker-pool.ts
export const WORKER_CONFIG = {
  enrichment: {
    min: 2,
    max: 10,
    cpuPerWorker: 2,
    memPerWorker: 1024, // MB
  },
  outreach: {
    min: 2,
    max: 8,
    cpuPerWorker: 1,
    memPerWorker: 512,
  },
  emailSend: {
    min: 4,
    max: 16,
    cpuPerWorker: 1,
    memPerWorker: 256,
  },
};
```

**Scaling Rules:**
```
If queue depth > 1000:
  └─ Scale up (add 2 workers)

If queue depth < 100 for 5 min:
  └─ Scale down (remove 1 worker)

If CPU > 80% for 2 min:
  └─ Scale up immediately

If CPU < 20% for 10 min:
  └─ Scale down
```

---

### 1.3 Deployment

**Docker Container:**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm ci --only=production
COPY . .
EXPOSE 8000
ENV WORKER_TYPE=enrichment
ENV CONCURRENCY=2
CMD ["tsx", "scripts/run-worker.ts"]
```

**Kubernetes Deployment:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vrashows-enrichment-worker
spec:
  replicas: 3
  selector:
    matchLabels:
      app: enrichment-worker
  template:
    metadata:
      labels:
        app: enrichment-worker
    spec:
      containers:
      - name: enrichment
        image: vrashows:latest
        env:
        - name: WORKER_TYPE
          value: "enrichment"
        - name: CONCURRENCY
          value: "4"
        resources:
          requests:
            cpu: "2"
            memory: "1Gi"
          limits:
            cpu: "4"
            memory: "2Gi"
        livenessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 30
          periodSeconds: 10
```

---

## Phase 2: Intelligent Caching

### 2.1 Multi-Level Cache

```
Request
  ↓
L1 Cache (in-memory, < 1ms)
  ├─ Hit? → Return
  └─ Miss? ↓
L2 Cache (Redis, ~10-50ms)
  ├─ Hit? → Return + populate L1
  └─ Miss? ↓
L3 Source (API/DB, 100-1000ms)
  ├─ Fetch
  └─ Populate L2 + L1
```

**Cache Strategy by Layer:**

| Layer | TTL | Size | Hit Rate Target |
|---|---|---|---|
| **L1 (in-memory)** | 1 hour | 100MB | 80%+ |
| **L2 (Redis)** | 24 hours | 1GB | 60%+ |
| **L3 (Source)** | — | unlimited | — |

**Implementation:**

```typescript
// memory/cache-manager.ts
class CacheManager {
  async get(key: string): Promise<any> {
    // L1: in-memory
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key);
    }

    // L2: Redis
    const cached = await redis.get(key);
    if (cached) {
      this.memoryCache.set(key, JSON.parse(cached));
      return JSON.parse(cached);
    }

    // L3: Source (fallback)
    return null;
  }

  async set(key: string, value: any, ttl = 86400) {
    this.memoryCache.set(key, value); // L1
    await redis.setex(key, ttl, JSON.stringify(value)); // L2
  }
}
```

---

### 2.2 Selective Cache Invalidation

```typescript
// Instead of invalidating entire cache, use patterns:

// Invalidate all leads for company X
await redis.del(`company:${companyId}:*`);

// Invalidate all embeddings for user
await redis.del(`embedding:user:${userId}:*`);

// Smart TTL:
//  - Company data: 7 days
//  - Lead contact: 24 hours
//  - Embeddings: 30 days
//  - Transcripts: 1 hour (stale content)
```

---

## Phase 3: Database Scaling

### 3.1 Read Replicas

```
Master PostgreSQL (write)
  ├─ Replica 1 (read)
  ├─ Replica 2 (read)
  └─ Replica 3 (read)

Routing:
  Writes → Master
  Reads → Round-robin replicas (split load)
```

**Connection Pooling:**
```typescript
// config/database.ts
export const pool = new Pool({
  host: 'master.db.internal', // writes
  replicationMode: 'auto', // auto-detect master/replica
  replicas: [
    'replica1.db.internal',
    'replica2.db.internal',
    'replica3.db.internal',
  ],
  max: 20,
  idleTimeoutMillis: 30000,
});
```

---

### 3.2 Partition Strategy for Large Tables

**Leads table (partitioned by date):**

```sql
CREATE TABLE leads (
  id UUID PRIMARY KEY,
  company_id UUID,
  created_at TIMESTAMP,
  ...
) PARTITION BY RANGE (YEAR(created_at), MONTH(created_at));

CREATE TABLE leads_y2026m05 PARTITION OF leads
  FOR VALUES FROM (2026, 5) TO (2026, 6);

CREATE TABLE leads_y2026m06 PARTITION OF leads
  FOR VALUES FROM (2026, 6) TO (2026, 7);
```

**Benefits:**
- Faster queries (partition pruning)
- Parallel index operations
- Easier archival (drop old partitions)

---

### 3.3 pgvector Scaling (Sharding)

**Shard by lead_id hash:**

```typescript
// memory/shard-router.ts
function getVectorShard(leadId: string): number {
  const hash = crc32(leadId);
  const shardCount = 4; // 4 shards
  return hash % shardCount;
}

const vectorDbs = [
  'pgvector-shard-0.db.internal', // vectors 0-250K
  'pgvector-shard-1.db.internal', // vectors 250K-500K
  'pgvector-shard-2.db.internal', // vectors 500K-750K
  'pgvector-shard-3.db.internal', // vectors 750K+
];

async function retrieveVectors(leadId: string, query: number[]) {
  const shardIdx = getVectorShard(leadId);
  const db = vectorDbs[shardIdx];
  return await db.vectorSearch(query, { limit: 5 });
}
```

---

## Phase 4: API Rate Limiting & Batching

### 4.1 Intelligent Batching

```typescript
// tools/batch-executor.ts
async function batchExecute(items: any[], batchSize = 10) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(item => executeWithRetry(item))
    );
    results.push(...batchResults);

    // Apply backpressure
    if (i % (batchSize * 10) === 0) {
      await delay(1000); // Cool down after 100 items
    }
  }
  return results;
}
```

**Resend Batch API:**
```typescript
// Instead of:
for (const lead of leads) {
  await resend.emails.send(lead); // 1 API call per lead
}

// Use batch:
const batch = leads.map(lead => ({
  to: lead.email,
  subject: lead.subject,
  html: lead.html,
}));
await resend.batch.send(batch); // 1 API call for 100+ leads
```

---

### 4.2 Circuit Breaker

```typescript
// tools/circuit-breaker.ts
class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  state = 'CLOSED'; // CLOSED → OPEN → HALF_OPEN → CLOSED

  async execute(fn: () => Promise<any>) {
    if (this.state === 'OPEN') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure > 60000) {
        this.state = 'HALF_OPEN'; // Try recovery
      } else {
        throw new Error('Circuit breaker OPEN');
      }
    }

    try {
      const result = await fn();
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.failureCount = 0;
      }
      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      if (this.failureCount > 5) {
        this.state = 'OPEN';
      }
      throw error;
    }
  }
}
```

---

## Phase 5: Async Task Processing

### 5.1 Job Queue

```typescript
// workflows/job-queue.ts
type Job = {
  id: string;
  type: 'enrich-lead' | 'generate-outreach' | 'send-email';
  payload: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
  result?: any;
};

async function enqueueJob(job: Job) {
  await redis.rpush('job-queue', JSON.stringify(job));
}

async function processJobs() {
  while (true) {
    const job = await redis.lpop('job-queue');
    if (!job) {
      await delay(1000);
      continue;
    }

    try {
      const result = await executeJob(JSON.parse(job));
      await redis.hset(`job:${job.id}`, 'status', 'completed', 'result', JSON.stringify(result));
    } catch (error) {
      await redis.hset(`job:${job.id}`, 'status', 'failed', 'error', error.message);
    }
  }
}
```

---

## Scaling Envelope by Phase

```
Phase 0 (May):  MVP    | 10-50 leads/day   | 1x Node
Phase 1 (June): Workers | 100-500 leads/day | 4x Workers
Phase 2 (July): Caching | 500-2K leads/day  | 4x Workers + Redis
Phase 3 (Aug):  Database| 2K-10K leads/day  | 4x Workers + Replicas
Phase 4 (Sept): Batching| 10K+ leads/day    | Full distributed
```

---

## Resource Allocation by Scale

| Scale | Nodes | CPU | Memory | Storage | Cost/month |
|---|---|---|---|---|---|
| **MVP** | 1 | 2 cores | 2GB | 20GB | $50 |
| **Scale 1** | 5 | 10 cores | 10GB | 50GB | $300 |
| **Scale 2** | 10 | 20 cores | 20GB | 100GB | $600 |
| **Enterprise** | 20+ | 40+ cores | 40GB+ | 500GB+ | $1500+ |

---

## Performance Targets by Phase

```
Phase 1 (June):
  Throughput:  500 leads/day
  Latency p95: 5s per lead
  Cost:        $0.02 per lead
  Uptime:      99.5%

Phase 2 (July):
  Throughput:  2K leads/day
  Latency p95: 2s per lead
  Cost:        $0.01 per lead
  Uptime:      99.9%

Phase 3 (Aug):
  Throughput:  10K leads/day
  Latency p95: 1s per lead
  Cost:        $0.005 per lead
  Uptime:      99.99%
```

---

## Monitoring Scaling Health

```
Scaling Dashboard:
├─ Queue Depth (target: < 100)
├─ Worker Utilization (target: 60-80%)
├─ Latency p95 (target: < 5s)
├─ Cost per lead (target: $0.01)
├─ Node count (scaling policy)
└─ Uptime (target: 99.9%+)
```

---

## Conclusion

Escalabilidade horizontal requer arquitetura distribuída, caching inteligente e monitoramento contínuo. Implemente fases sequencialmente; cada fase habilita próxima.
