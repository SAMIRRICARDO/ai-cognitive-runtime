# System Guardrails & Safety Rails

## Overview

Guardrails operacionais para prevenir execução runaway, explosão de custos, degradação de qualidade e comportamento emergente não-controlado no VRASHOWS AI Runtime.

---

## Principle

> **Fail safely, detect early, degrade gracefully.**

Guardrails são **defensas em profundidade**. Múltiplas camadas garantem que falhas sejam detectadas antes de causar dano significativo.

---

## Category 1: Token & Cost Explosion

### 1.1 Token Cap per Request

**Rule:** Nenhum agente pode usar > 50K tokens em um único request.

```typescript
// agents/_base/agent.ts
async execute(input: string): Promise<string> {
  const maxTokens = 50000;
  let totalTokens = 0;

  const response = await this.client.messages.create({
    model: this.model,
    max_tokens: 4096,
    messages: [...],
  });

  totalTokens += response.usage.input_tokens + response.usage.output_tokens;

  if (totalTokens > maxTokens) {
    this.logger.error(`Token explosion detected: ${totalTokens} > ${maxTokens}`);
    throw new Error('GUARDRAIL_BREACH: Token limit exceeded');
  }

  return response.content[0].type === 'text' ? response.content[0].text : '';
}
```

**Trigger:** 50K tokens
**Action:** Throw error, fail-safe
**Alert:** Email + Slack (immediate)
**Recover:** Manual investigation

---

### 1.2 Daily Cost Cap

**Rule:** Nenhum dia pode exceder $500 em custos de API.

```typescript
// config/guardrails.ts
export async function checkDailyCostCap() {
  const today = new Date().toISOString().split('T')[0];
  const costs = await redis.get(`cost:daily:${today}`);
  const dailyTotal = parseFloat(costs || '0');

  if (dailyTotal > 500) {
    await redis.setex(`GUARDRAIL:daily_cost_breach`, 3600, today);
    throw new Error(`GUARDRAIL_BREACH: Daily cost $${dailyTotal} > $500`);
  }
}
```

**Trigger:** $500/day
**Action:** Block all agents, emergency shutdown
**Alert:** Email + Slack + PagerDuty
**Recover:** Manual approval required

---

### 1.3 Per-Agent Cost Budget

**Rule:** Nenhum agente pode gastar > $100/dia.

```typescript
// config/guardrails.ts
const AGENT_BUDGETS = {
  'futurecom-researcher': 50, // $50/day
  'lead-enrichment': 40,
  'outreach': 30,
  'email-sender': 10,
  'memory-manager': 20,
};

async function checkAgentBudget(agentName: string, costIncrement: number) {
  const today = new Date().toISOString().split('T')[0];
  const key = `cost:agent:${agentName}:${today}`;
  const spent = parseFloat(await redis.get(key) || '0');
  const budget = AGENT_BUDGETS[agentName];

  if (spent + costIncrement > budget) {
    throw new Error(`GUARDRAIL_BREACH: Agent ${agentName} budget exceeded`);
  }
}
```

**Trigger:** Agent budget exceeded
**Action:** Block agent, log alert
**Alert:** Slack (agent-specific channel)
**Recover:** Reset daily; notify ops

---

## Category 2: Iteration & Convergence

### 2.1 Max Iterations per Agent

**Rule:** Nenhum agente pode fazer > 10 loops (tool calls + reasoning).

```typescript
// agents/_base/agent.ts
async executeWithRetry(input: string, maxIterations = 10): Promise<string> {
  let iteration = 0;

  while (iteration < maxIterations) {
    const response = await this.client.messages.create({
      model: this.model,
      messages: [...],
      tools: this.tools,
    });

    if (response.stop_reason === 'end_turn') {
      return this.extractText(response);
    }

    if (response.stop_reason === 'tool_use') {
      // Process tool call, iteration++
      iteration++;
      if (iteration >= maxIterations) {
        throw new Error(`GUARDRAIL_BREACH: Max iterations (${maxIterations}) exceeded`);
      }
    }
  }
}
```

**Trigger:** 10 iterations
**Action:** Throw error, return best-effort result
**Alert:** Warning log (expected in some workflows)
**Recover:** Manual retry or input refinement

---

### 2.2 Timeout per Agent

**Rule:** Nenhum agente pode rodar > 5 minutos.

```typescript
// agents/_base/agent.ts
async execute(input: string, timeout = 300000): Promise<string> {
  return Promise.race([
    this._executeInternal(input),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('GUARDRAIL_BREACH: Execution timeout')), timeout)
    ),
  ]);
}
```

**Trigger:** 5 minutes elapsed
**Action:** Abort execution, return partial result
**Alert:** Warning log
**Recover:** Timeout indicates complexity; review agent design

---

## Category 3: Queue & Concurrency

### 3.1 Max Queue Size

**Rule:** Queue de outreach nunca > 10K items.

```typescript
// workflows/orchestrator.ts
async addToOutreachQueue(lead: Lead) {
  const queueSize = await redis.llen('outreach:queue');

  if (queueSize > 10000) {
    throw new Error('GUARDRAIL_BREACH: Outreach queue overflow');
  }

  await redis.rpush('outreach:queue', JSON.stringify(lead));
}
```

**Trigger:** 10K items
**Action:** Block new queue entries
**Alert:** Slack (ops channel)
**Recover:** Drain queue (send emails) before resuming

---

### 3.2 Max Concurrent Workers

**Rule:** Máximo 4 workers paralelos.

```typescript
// config/guardrails.ts
export const MAX_CONCURRENCY = 4; // Never exceed

// workflows/orchestrator.ts
const results = await pLimit(MAX_CONCURRENCY)(workers.map(w => w.execute()));
```

**Trigger:** Attempted > 4 concurrent
**Action:** Queue remaining tasks
**Alert:** Debug log only
**Recover:** Automatic (queued tasks wait for slot)

---

### 3.3 Max Email Rate

**Rule:** Máximo 100 emails/hora.

```typescript
// tools/send-email.ts
async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const hourKey = `ratelimit:email:${Date.now() / 3600000 | 0}`;
  const count = await redis.incr(hourKey);
  await redis.expire(hourKey, 3600);

  if (count > 100) {
    throw new Error('GUARDRAIL_BREACH: Email rate limit exceeded');
  }

  return await resend.emails.send(params);
}
```

**Trigger:** > 100 emails/hour
**Action:** Block send, add to queue
**Alert:** Info log
**Recover:** Automatic rate limiting (backoff)

---

## Category 4: Quality & Validation

### 4.1 Outreach Quality Score Minimum

**Rule:** Nenhum email com qualidade < 50%.

```typescript
// agents/outreach-agent/agent.ts
async generateOutreach(lead: Lead): Promise<Outreach> {
  const outreach = await this.generateOutreachContent(lead);
  const quality = await emailQuality.score(outreach.body);

  if (quality.score < 0.5) {
    this.logger.warn(`Low quality outreach: ${quality.score} < 0.5`);
    throw new Error('GUARDRAIL_BREACH: Quality score too low');
  }

  return outreach;
}
```

**Trigger:** Quality < 50%
**Action:** Reject outreach, log issue
**Alert:** Slack (content review)
**Recover:** Retry with different approach or skip lead

---

### 4.2 Context Compression Threshold

**Rule:** Contexto comprimido nunca > 10% de perda de informação.

```typescript
// agents/_base/agent.ts
async compressContext(context: string, maxTokens: number): Promise<string> {
  const compressed = await this.contextCompressor.compress(context, maxTokens);
  const compressionRatio = compressed.length / context.length;

  if (compressionRatio < 0.1) {
    this.logger.warn(`High compression ratio: ${compressionRatio}`);
    // Fallback: truncate instead of compress to preserve meaning
    return context.substring(0, maxTokens * 4); // rough estimate
  }

  return compressed;
}
```

**Trigger:** > 90% loss detected
**Action:** Use fallback (truncate)
**Alert:** Warning log
**Recover:** Review context size; refactor prompt

---

## Category 5: Data & Memory

### 5.1 Memory Injection Size

**Rule:** Injected memory nunca > 2KB por request.

```typescript
// memory/manager.ts
async injectMemory(leadId: string, companyId: string): Promise<string> {
  const memory = await this.retrieve(leadId, companyId);
  const serialized = JSON.stringify(memory);

  if (serialized.length > 2048) {
    // Truncate or filter
    return this.selectRelevantMemory(memory, 2048);
  }

  return serialized;
}
```

**Trigger:** > 2KB memory
**Action:** Filter/truncate to relevance
**Alert:** Debug log
**Recover:** Automatic filtering

---

### 5.2 Embedding Cache Freshness

**Rule:** Cache não pode ter > 7 dias de idade.

```typescript
// memory/vault-index.ts
async getEmbedding(text: string): Promise<number[]> {
  const cached = await redis.get(`embedding:${hash(text)}`);
  const age = await redis.ttl(`embedding:${hash(text)}`);

  if (cached && age < 604800) { // 7 days
    return JSON.parse(cached);
  }

  const embedding = await openai.embeddings.create({ input: text });
  await redis.setex(`embedding:${hash(text)}`, 604800, JSON.stringify(embedding.data[0].embedding));

  return embedding.data[0].embedding;
}
```

**Trigger:** Cache > 7 days
**Action:** Refresh embedding
**Alert:** Debug log
**Recover:** Automatic refresh

---

## Category 6: External Dependencies

### 6.1 Resend API Timeout

**Rule:** Resend call nunca > 10 segundos.

```typescript
// tools/send-email.ts
const sendPromise = resend.emails.send(params);
const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('GUARDRAIL_BREACH: Resend timeout')), 10000)
);

const result = await Promise.race([sendPromise, timeoutPromise]);
```

**Trigger:** 10 seconds
**Action:** Fail email send, add to retry queue
**Alert:** Info log
**Recover:** Automatic retry (exponential backoff)

---

### 6.2 PostgreSQL Connection Pool

**Rule:** Max 20 concurrent connections.

```typescript
// config/database.ts
const pool = new Pool({
  max: 20, // Guardrail
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

**Trigger:** > 20 connections
**Action:** Queue new queries
**Alert:** Warning log
**Recover:** Automatic pooling (wait for slot)

---

### 6.3 Redis Connection Failure

**Rule:** Gracefully degrade khi Redis unavailable.

```typescript
// memory/short-term/redis.ts
async get(key: string): Promise<string | null> {
  try {
    return await redis.get(key);
  } catch (error) {
    this.logger.warn(`Redis error, degrading: ${error.message}`);
    return null; // Degrade gracefully
  }
}
```

**Trigger:** Redis connection error
**Action:** Fall back to no-cache mode
**Alert:** Warning log
**Recover:** Automatic retry on next operation

---

## Category 7: Emergency Shutdown

### 7.1 Circuit Breaker Pattern

**Rule:** Se múltiplos guardrails acionados em 1 minuto, ativar circuit breaker.

```typescript
// config/guardrails.ts
let breachCount = 0;
let lastBreachTime = 0;

export async function recordBreach() {
  const now = Date.now();
  if (now - lastBreachTime < 60000) {
    breachCount++;
  } else {
    breachCount = 1;
  }
  lastBreachTime = now;

  if (breachCount > 3) {
    await emergencyShutdown('Multiple guardrails breached');
  }
}

async function emergencyShutdown(reason: string) {
  console.error(`EMERGENCY SHUTDOWN: ${reason}`);
  await redis.setex('system:shutdown', 3600, reason);
  process.exit(1); // Force shutdown
}
```

**Trigger:** 3+ guardrails em 1 minuto
**Action:** Emergency shutdown
**Alert:** PagerDuty + Email + Slack (immediately)
**Recover:** Manual investigation required

---

## Category 8: Cheap Mode Enforcement

### 8.1 Cheap Mode Token Limit

**Rule:** Em cheap mode, max 2048 output tokens.

```typescript
// config/models.ts
export const MODELS = {
  cheap: {
    name: 'claude-3-5-haiku-20241022',
    maxOutputTokens: 2048,
    maxIterations: 5,
    contextTokenLimit: 8000,
  },
};

// agents/_base/agent.ts
if (isCheapMode) {
  if (response.usage.output_tokens > 2048) {
    throw new Error('GUARDRAIL_BREACH: Cheap mode output exceeded');
  }
}
```

**Trigger:** > 2048 output tokens em cheap mode
**Action:** Truncate output
**Alert:** Warning log
**Recover:** Review prompt complexity

---

### 8.2 Cheap Mode Iteration Limit

**Rule:** Em cheap mode, max 5 iterations.

```typescript
// agents/_base/agent.ts
if (isCheapMode && iteration > 5) {
  throw new Error('GUARDRAIL_BREACH: Cheap mode iteration limit exceeded');
}
```

**Trigger:** > 5 iterations em cheap mode
**Action:** Stop iterations, return best result
**Alert:** Debug log
**Recover:** Manual oversight

---

## Guardrails Dashboard

```
┌─────────────────────────────────────────────────────┐
│          VRASHOWS GUARDRAILS STATUS                 │
├─────────────────────────────────────────────────────┤
│ Daily Cost:      $127.50 / $500.00    [████░░░░░░] │
│ Token Rate:      2.1K/min             [normal]     │
│ Queue Size:      234 items / 10K      [green]      │
│ Worker Concurrency: 2/4               [green]      │
│ Email Rate:      12/hour / 100        [green]      │
│ Redis Status:    Connected (1.2GB)    [healthy]    │
│ PostgreSQL:      20/20 connections    [warning]    │
│ Circuit Breaker: Armed                [normal]     │
│ Last Breach:     none (run 14 days)   [healthy]    │
└─────────────────────────────────────────────────────┘
```

---

## Monitoring & Alerting

### Alert Rules

| Guardrail | Threshold | Severity | Channels |
|---|---|---|---|
| Daily cost | $500 | 🔴 CRITICAL | PagerDuty, Email, Slack |
| Token explosion | 50K | 🔴 CRITICAL | PagerDuty, Email, Slack |
| Circuit breaker | 3 breaches/min | 🔴 CRITICAL | PagerDuty, Email, Slack |
| Agent budget | Exceeded | 🟡 HIGH | Slack (ops) |
| Queue overflow | 10K items | 🟡 HIGH | Slack (ops) |
| Email rate limit | 100/hour | 🟢 INFO | Debug log |
| Redis error | Connection fail | 🟡 HIGH | Slack (platform) |
| DB pool exhausted | 20 connections | 🟡 MEDIUM | Slack (platform) |

---

## Testing Guardrails

### Simulation Script

```bash
# Test token explosion
tsx scripts/test-guardrails.ts --breach=token-explosion

# Test daily cost
tsx scripts/test-guardrails.ts --breach=daily-cost

# Test queue overflow
tsx scripts/test-guardrails.ts --breach=queue-overflow

# Test all
tsx scripts/test-guardrails.ts --breach=all
```

---

## Conclusion

Guardrails são **não-negociáveis** para operação enterprise. Implementar todas as categorias antes de scale-out.

**Compliance Checklist:**
- [ ] Token guards implemented
- [ ] Cost caps enforced
- [ ] Iteration limits checked
- [ ] Queue limits verified
- [ ] Quality validation active
- [ ] Cheap mode enforcement
- [ ] Circuit breaker armed
- [ ] Monitoring alerts configured
- [ ] Testing suite passing
- [ ] Documentation updated
