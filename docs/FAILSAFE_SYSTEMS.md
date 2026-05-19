# VRASHOWS Failsafe Systems & Resilience

## Overview

Arquitetura de resiliência para manter o VRASHOWS operacional mesmo com falhas de componentes, APIs ou dados.

---

## Failsafe Principles

1. **Fail quickly** — Detecte falhas em < 1 segundo
2. **Fail safely** — Não cause cascata de falhas
3. **Recover automatically** — Sem intervenção manual (quando possível)
4. **Degrade gracefully** — Reduza funcionalidade, não falhe completamente

---

## Layer 1: Provider Outage Handling

### 1.1 Claude API Failover

**Scenario:** Claude API timeout ou throttle.

```typescript
// agents/_base/agent.ts
async function executeWithFallback(input: string): Promise<string> {
  const providers = [
    { model: 'claude-3-5-sonnet', weight: 1.0 },
    { model: 'claude-3-haiku', weight: 0.8 }, // fallback (cheaper, faster)
  ];

  for (const provider of providers) {
    try {
      const response = await this.client.messages.create({
        model: provider.model,
        messages: [...],
        timeout: 10000, // 10 second timeout
      });
      return response.content[0].text;
    } catch (error) {
      if (error.status === 429) { // Rate limited
        logger.warn(`Claude throttled, trying fallback: ${provider.model}`);
        continue;
      }
      throw error; // Unrecoverable error
    }
  }

  // All providers failed
  throw new Error('All Claude models failed');
}
```

**Behavior:**
```
Primary: Sonnet (best quality)
  ├─ Success? Return
  └─ Timeout/throttle? →
Fallback 1: Haiku (cheaper)
  ├─ Success? Return (log degradation)
  └─ Failure? →
Fallback 2: Cached response (if available)
  ├─ Success? Return (log cache usage)
  └─ All failed: Error out, alert ops
```

---

### 1.2 Resend Email Provider Redundancy

**Scenario:** Resend timeout or outage.

```typescript
// tools/send-email.ts
const emailProviders = [
  { client: resend, name: 'resend', priority: 1 },
  { client: sendgrid, name: 'sendgrid', priority: 2 },
  { client: mailgun, name: 'mailgun', priority: 3 },
];

async function sendEmailWithFailover(params: SendEmailParams): Promise<SendEmailResult> {
  for (const provider of emailProviders) {
    try {
      const result = await Promise.race([
        provider.client.send(params),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 5000)
        ),
      ]);

      logger.info(`Email sent via ${provider.name}`, { messageId: result.id });
      return result;
    } catch (error) {
      logger.warn(`${provider.name} failed, trying next provider`, { error: error.message });
      continue;
    }
  }

  throw new Error('All email providers failed');
}
```

**Cost Tracking:**
```typescript
// Only charge for successful sends
if (provider.name === 'resend') {
  costUSD += 0.0001; // Resend rate
} else if (provider.name === 'sendgrid') {
  costUSD += 0.0001; // SendGrid rate
} else if (provider.name === 'mailgun') {
  costUSD += 0.00005; // Mailgun rate
}
```

---

### 1.3 OpenAI Failback (Embeddings)

**Scenario:** OpenAI embeddings slow or unavailable.

```typescript
// memory/embeddings.ts
const embeddingProviders = [
  { name: 'openai', model: 'text-embedding-3-small' },
  { name: 'local', model: 'sentence-transformers/all-MiniLM-L6-v2' }, // fallback
];

async function getEmbedding(text: string): Promise<number[]> {
  // Check cache first
  const cached = await redis.get(`embedding:${hash(text)}`);
  if (cached) return JSON.parse(cached);

  for (const provider of embeddingProviders) {
    try {
      const embedding = await provider.getEmbedding(text);
      await redis.setex(`embedding:${hash(text)}`, 86400, JSON.stringify(embedding));
      return embedding;
    } catch (error) {
      logger.warn(`${provider.name} embeddings failed, trying fallback`);
      continue;
    }
  }

  throw new Error('All embedding providers failed');
}
```

---

## Layer 2: Circuit Breaker Pattern

### 2.1 Generic Circuit Breaker

```typescript
// config/circuit-breaker.ts
class CircuitBreaker {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  failureCount = 0;
  lastFailureTime = 0;
  successCount = 0;

  constructor(
    private name: string,
    private failureThreshold = 5,
    private successThreshold = 2,
    private timeout = 60000 // 1 min
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure > this.timeout) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
      } else {
        throw new Error(`Circuit breaker OPEN: ${this.name}`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failureCount = 0;
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = 'CLOSED';
        logger.info(`Circuit breaker ${this.name} CLOSED`);
      }
    }
  }

  private onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      logger.error(`Circuit breaker ${this.name} OPEN`);
    }
  }
}

// Usage:
const claudeBreaker = new CircuitBreaker('claude', 5, 2, 60000);
const resendBreaker = new CircuitBreaker('resend', 3, 2, 30000);

await claudeBreaker.execute(() => claude.messages.create(...));
await resendBreaker.execute(() => resend.emails.send(...));
```

---

## Layer 3: Retry Strategy

### 3.1 Exponential Backoff

```typescript
// config/retry.ts
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000,
  maxDelay = 32000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries) {
        break; // No more retries
      }

      // Calculate delay with jitter
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      const jitter = Math.random() * 0.1 * delay;
      const totalDelay = delay + jitter;

      logger.warn(`Retry attempt ${attempt + 1}/${maxRetries}, delay ${totalDelay}ms`, {
        error: error.message,
      });

      await sleep(totalDelay);
    }
  }

  throw lastError;
}

// Usage:
const response = await retryWithBackoff(() => resend.emails.send(params), 3, 1000);
```

**Backoff Schedule:**
```
Attempt 1: fail
Delay:     1000ms + jitter
Attempt 2: fail
Delay:     2000ms + jitter
Attempt 3: fail
Delay:     4000ms + jitter
Attempt 4: fail
Give up:   throw error
```

---

### 3.2 Conditional Retry (Only Retryable Errors)

```typescript
// Retryable vs non-retryable errors
const RETRYABLE_ERRORS = [
  'ECONNRESET', // Connection reset
  'ETIMEDOUT', // Timeout
  'EHOSTUNREACH', // Host unreachable
  429, // Rate limited
  500, // Server error
  502, // Bad gateway
  503, // Service unavailable
];

const NON_RETRYABLE_ERRORS = [
  400, // Bad request
  401, // Unauthorized
  403, // Forbidden
  404, // Not found
];

async function retryIfRetryable<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryable(error)) {
        throw error; // Non-retryable, fail fast
      }

      lastError = error;
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

function isRetryable(error: any): boolean {
  if (error.code && RETRYABLE_ERRORS.includes(error.code)) return true;
  if (error.status && RETRYABLE_ERRORS.includes(error.status)) return true;
  return false;
}
```

---

## Layer 4: Graceful Degradation

### 4.1 Memory Unavailable

**Scenario:** PostgreSQL down, Redis down.

```typescript
// memory/manager.ts
async function retrieveMemory(leadId: string): Promise<string> {
  try {
    // Try long-term memory (PostgreSQL)
    return await postgres.getMemory(leadId);
  } catch (error) {
    logger.warn('Long-term memory unavailable, trying cache');

    try {
      // Try Redis cache
      return await redis.get(`memory:${leadId}`);
    } catch (error) {
      logger.warn('All memory sources unavailable, degrading to empty context');
      return ''; // Degrade: no memory, but continue
    }
  }
}
```

**Impact:**
```
✅ Normal: Personal history + strategic context injected
⚠️ Degraded: No memory, but outreach still possible (lower quality)
🔴 Failed: Complete failure, block request
```

---

### 4.2 Cache Unavailable

**Scenario:** Redis down.

```typescript
// memory/cache-manager.ts
async function get(key: string): Promise<any> {
  try {
    return await redis.get(key);
  } catch (error) {
    logger.warn('Cache unavailable, continuing without cache');
    return null; // Degrade gracefully
  }
}
```

**Cost:** ~10x slower queries, but system stays up.

---

## Layer 5: Dead-Letter Queues

### 5.1 Failed Email Queue

**Scenario:** Email send fails after all retries.

```typescript
// workflows/dead-letter.ts
async function sendEmailWithDLQ(lead: Lead, email: Email): Promise<void> {
  try {
    await retryWithBackoff(() => sendEmail(email), 3, 1000);
  } catch (error) {
    logger.error('Email send failed after retries, moving to DLQ', {
      leadId: lead.id,
      email: email.to,
      error: error.message,
    });

    await redis.rpush(
      'dlq:email',
      JSON.stringify({
        leadId: lead.id,
        email,
        error: error.message,
        timestamp: new Date(),
        retryCount: 3,
      })
    );
  }
}

// Process DLQ manually
async function processDLQ() {
  const dlqItems = await redis.lrange('dlq:email', 0, -1);
  for (const item of dlqItems) {
    const { leadId, email, retryCount } = JSON.parse(item);
    logger.info('Reviewing DLQ item', { leadId, email: email.to, retryCount });
    // Manual intervention or specialized retry logic
  }
}
```

---

## Layer 6: Data Backup & Recovery

### 6.1 Database Snapshots

```typescript
// scripts/backup-runtime.ts
async function createSnapshot() {
  const timestamp = new Date().toISOString();
  const snapshotPath = `backups/snapshots/${timestamp}/`;

  // Backup PostgreSQL
  await exec(`pg_dump postgresql://... > ${snapshotPath}/postgres.sql`);

  // Backup Redis
  await exec(`redis-cli BGSAVE`);
  await exec(`cp /var/lib/redis/dump.rdb ${snapshotPath}/`);

  // Backup queue files
  await exec(`cp -r data/outreach/ ${snapshotPath}/`);

  logger.info(`Snapshot created: ${snapshotPath}`);
}

// Hourly snapshots
setInterval(createSnapshot, 3600000);
```

---

### 6.2 Restore Procedure

```bash
# Restore from snapshot
npm run infra:restore -- --snapshot=2026-05-19T12-34-56.000Z

# Verification
npm run health:check
```

---

## Layer 7: Monitoring for Failsafe Activation

### 7.1 Failsafe Dashboard

```
FAILSAFE STATUS
═════════════════════════════════════════════════════════

Circuit Breakers:
  ├─ Claude:        CLOSED (healthy)
  ├─ Resend:        CLOSED (healthy)
  ├─ PostgreSQL:    CLOSED (healthy)
  └─ Redis:         CLOSED (healthy)

Failsafe Activations (24h):
  ├─ Claude fallback:   0 times
  ├─ Resend failover:   0 times
  ├─ Memory degraded:   0 times
  └─ Cache bypass:      2 times (minor)

DLQ Items:
  ├─ Email DLQ:        0 items
  ├─ Enrichment DLQ:   0 items
  └─ Outreach DLQ:     0 items

Last Incident:
  Date:      May 18, 2026 14:32 UTC
  Cause:     Resend API throttle
  Duration:  45 seconds
  Impact:    Automatic fallover to SendGrid
  Status:    RESOLVED
```

---

## Failsafe Testing

### 8.1 Chaos Engineering

```bash
# Test Claude failover
npm run chaos:test -- --target=claude --type=timeout

# Test Resend failover
npm run chaos:test -- --target=resend --type=rate-limit

# Test memory degradation
npm run chaos:test -- --target=postgres --type=shutdown

# Test cache bypass
npm run chaos:test -- --target=redis --type=shutdown
```

---

## Runbook: What to Do When Things Break

### 9.1 Claude Timeout

**Symptom:** Agents taking > 30 seconds

**Check:**
```bash
curl https://status.anthropic.com
```

**Action:**
- [ ] Verify circuit breaker OPEN
- [ ] Check logs for fallback model (should be Haiku)
- [ ] If fallback also failing, check network connectivity
- [ ] Wait for Anthropic to recover (or use cached responses)

**Recovery:** Automatic (circuit breaker enters HALF_OPEN after 60s)

---

### 9.2 Resend Outage

**Symptom:** All emails failing with 503

**Check:**
```bash
curl https://status.resend.com
```

**Action:**
- [ ] Verify failover to SendGrid active
- [ ] Check DLQ for failed emails: `redis-cli llen dlq:email`
- [ ] If SendGrid also failing, escalate to on-call
- [ ] Queue is safe (persisted in file system)

**Recovery:** Automatic failover + retry

---

### 9.3 PostgreSQL Down

**Symptom:** Memory retrieval failing, agents degrading

**Check:**
```bash
psql postgresql://...
```

**Action:**
- [ ] Check logs: `grep "error" logs/combined.log`
- [ ] Verify replica status
- [ ] If master down, promote replica: `pg_ctl promote`
- [ ] Restore from snapshot if data corruption

**Recovery:** Manual intervention (promote replica)

---

## Failsafe Summary

```
Failsafe Layer | Coverage | Automatic | Manual Intervention
────────────────────────────────────────────────────────
Provider outage    | 95%     | Yes      | —
Circuit breaker    | 90%     | Yes      | —
Retry strategy     | 80%     | Yes      | —
Graceful degrade   | 85%     | Yes      | —
Dead-letter queue  | 70%     | Yes      | Monitor + replay
Data backup        | 100%    | Yes      | Restore if needed
────────────────────────────────────────────────────────
Overall coverage:  ~85% automatic, ~95% with manual ops
```

---

## Conclusion

Resiliência é construída em camadas. Nenhuma solução única resolve todas as falhas; múltiplas camadas garantem que o sistema continua operacional mesmo em degradação.

**Implementation Checklist:**
- [ ] Provider failover implemented
- [ ] Circuit breaker pattern in place
- [ ] Retry logic with exponential backoff
- [ ] Graceful degradation paths tested
- [ ] Dead-letter queues configured
- [ ] Backup/restore procedure documented
- [ ] Chaos testing executed
- [ ] Runbooks created for ops team
