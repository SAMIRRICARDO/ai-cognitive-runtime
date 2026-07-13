# VRASHOWS AI Provider Strategy

## Overview

Definição clara de qual AI provider utilizar para cada camada do runtime, minimizando custo e maximizando qualidade.

---

## Provider Landscape

```
Strategic Layer (Reasoning)
  └─ Claude (Anthropic) — best reasoning, strategic thinking

Worker Layer (Execution)
  ├─ Claude (Anthropic) — fallback, flexibility
  └─ OpenAI (GPT-4, Codex) — code, parsing, structured output

Embedding & Memory
  └─ OpenAI (text-embedding-3) — industry standard

Infrastructure
  ├─ Redis — cache, queue, dedup
  ├─ PostgreSQL + pgvector — semantic memory
  └─ Resend — email delivery
```

---

## Layer 1: Strategic Layer (Claude Only)

### 1.1 What Claude Does

**Claude excels at:**
- Multi-step reasoning
- Nuanced business decisions
- Brand voice / positioning
- Complex natural language
- Long-context understanding
- Adaptive prompting

**Use Cases:**
```
Strategic Tasks:
├─ Outreach generation (70% of calls)
├─ Company research
├─ Personalization logic
├─ Follow-up strategy
└─ Tone & voice consistency
```

### 1.2 Model Selection by Cost

| Model | Cost/1M tokens | Speed | Quality | Use Case |
|---|---|---|---|---|
| **Haiku** | $0.80 | 🟢 Fast | 🟡 Good | Dev, cheap mode |
| **Sonnet** | $3.00 | 🟡 Medium | 🟢 Excellent | Production default |
| **Opus** | $15.00 | 🔴 Slow | 🟢🟢 Best | Strategic only |

**Recommendation:**
```
Default: Sonnet (best quality/cost ratio)
Cheap mode: Haiku (10x cheaper, acceptable quality)
Strategic decisions: Opus (only for complex reasoning)

Never use Opus by default — reserve for high-value decisions.
```

### 1.3 Context Window Strategy

| Model | Window | Cost of 100K tokens |
|---|---|---|
| **Haiku** | 200K | $0.08 |
| **Sonnet** | 200K | $0.30 |
| **Opus** | 200K | $1.50 |

**Optimization:**
- Use selective memory injection (< 2KB per request)
- Compress historical context
- Reuse cached responses
- Never inject full conversation history

---

## Layer 2: Worker Layer (OpenAI Primary)

### 2.1 What OpenAI Excels At

**OpenAI strengths:**
- Structured output (JSON)
- Code generation
- Parsing & extraction
- Fast inference (GPT-4o)
- Reliable math

**Use Cases:**
```
Worker Tasks:
├─ Email validation / parsing (cost: $0.001 per lead)
├─ Lead scoring (deterministic)
├─ Contact enrichment (structured data)
├─ Data extraction (from web)
└─ List deduplication
```

### 2.2 OpenAI Models

| Model | Cost/1M tokens | Speed | Quality | Use Case |
|---|---|---|---|---|
| **GPT-4o mini** | $0.15 | 🟢 Fast | 🟡 Good | Lightweight tasks |
| **GPT-4o** | $2.50 | 🟡 Medium | 🟢 Excellent | Complex parsing |
| **o1-mini** | $3.00 | 🔴 Slow | 🟢🟢 Best | Complex reasoning |

**Recommendation:**
```
Default: GPT-4o mini (cost-effective)
Complex parsing: GPT-4o (when needed)
Deep reasoning: o1-mini (only for critical decisions)
```

### 2.3 Embeddings (OpenAI Only)

**Why OpenAI for embeddings:**
- Industry standard (1536-dimensional vectors)
- Stable model (no breaking changes)
- Fast inference (< 100ms)
- Compatible with pgvector

```
Model: text-embedding-3-small
Dimensions: 1536
Cost: $0.02 per 1M tokens
Use: All vector searches, memory indexing
```

---

## Cost Breakdown (Monthly)

**Scenario: 10K leads/month**

```
Strategic Layer (Claude):
├─ Outreach generation:  10K calls × 1.5K tokens × $3/1M = $45
├─ Company research:     2K calls × 2K tokens × $3/1M = $12
└─ Personalization:      5K calls × 500 tokens × $3/1M = $7.50

Subtotal Claude: $64.50

Worker Layer (OpenAI):
├─ Email validation:     10K calls × 100 tokens × $0.15/1M = $0.15
├─ Lead scoring:         10K calls × 200 tokens × $0.15/1M = $0.30
├─ Contact enrichment:   5K calls × 300 tokens × $0.15/1M = $0.22
└─ Data extraction:      2K calls × 500 tokens × $2.50/1M = $2.50

Subtotal OpenAI (non-embedding): $3.17

Embeddings (OpenAI):
├─ Company research:     2K vectors × 1K tokens = 2M tokens × $0.02/1M = $0.04
├─ Lead profiles:        10K vectors × 500 tokens = 5M tokens = $0.10
└─ Memory indexing:      2K vectors (reused) = $0.00

Subtotal OpenAI (embeddings): $0.14

Total: ~$68/month for 10K leads
Cost per lead: $0.0068

Breakdown:
├─ Claude: 95% of cost (strategic reasoning)
├─ OpenAI structured: 5% of cost (execution)
└─ Embeddings: < 1% of cost
```

---

## Decision Matrix: Which Provider?

```
┌─────────────────────────────────────────────────┐
│ TASK | CLAUDE? | OPENAI? | FALLBACK?           │
├─────────────────────────────────────────────────┤
│ Outreach generation     │ ✅ Yes | ❌ No  | Cached template │
│ Company research        │ ✅ Yes | ❌ No  | Web search      │
│ Personalization         │ ✅ Yes | ❌ No  | —               │
│ Email validation        │ ❌ No  | ✅ Yes | Regex           │
│ Lead scoring            │ ❌ No  | ✅ Yes | Static rules    │
│ Contact enrichment      │ ❌ No  | ✅ Yes | DB lookup       │
│ Data extraction         │ ❌ No  | ✅ Yes | Pattern matching│
│ Embeddings              │ ❌ No  | ✅ Yes | Local model     │
│ Follow-up strategy      │ ✅ Yes | ❌ No  | Template        │
│ List deduplication      │ ❌ No  | ✅ Yes | Hash-based      │
└─────────────────────────────────────────────────┘

Rule: If task requires subjective judgment → Claude
      If task is deterministic/structured → OpenAI
```

---

## Avoiding Provider Overlap

### ❌ Don't Do This

```typescript
// Using Claude for things OpenAI does better (waste of $$$)
const email = await claude.generateEmail(lead); // OK
const validated = await claude.validateEmail(email); // WRONG: use OpenAI
const score = await claude.scoreContact(lead); // WRONG: use OpenAI
```

### ✅ Do This

```typescript
// Proper division of labor
const email = await claude.generateEmail(lead); // Strategic
const validated = await openai.validateEmail(email); // Deterministic
const score = await openai.scoreContact(lead); // Structured
```

**Savings: 70% of API costs**

---

## Fallback Strategy by Layer

### Strategic Layer Fallback

```
Primary: Claude Sonnet
  ├─ Timeout? → Claude Haiku (faster, cheaper)
  ├─ Throttled? → Claude Haiku (auto-fallback)
  ├─ Cost over budget? → Cached template (no API call)
  └─ Complete failure? → Skip, log error, continue
```

### Worker Layer Fallback

```
Primary: OpenAI GPT-4o mini
  ├─ Timeout? → Retry with exponential backoff
  ├─ Parsing error? → GPT-4o (better instruction following)
  ├─ Still error? → Local parsing (regex, heuristics)
  └─ Complete failure? → Skip field, log warning
```

### Embedding Fallback

```
Primary: OpenAI text-embedding-3-small
  ├─ Timeout? → Local model (sentence-transformers)
  ├─ Rate limit? → Use cached embeddings
  └─ Complete failure? → Skip vector search (degrade to keyword search)
```

---

## Cost Governance by Provider

### 4.1 Claude Budget

**Daily limit:** $50

```typescript
// config/cost-governance.ts
const PROVIDER_BUDGETS = {
  claude: {
    dailyLimit: 50,
    perCallLimit: 0.10, // Don't call Claude if will exceed this
    defaultModel: 'claude-3-5-sonnet',
    cheapModel: 'claude-3-5-haiku',
  },
};

async function executeWithClaudebudget(fn: () => Promise<any>) {
  const today = new Date().toISOString().split('T')[0];
  const spent = await redis.get(`cost:claude:${today}`);
  const available = 50 - (spent || 0);

  if (available < 0.1) {
    // Near limit, use cheap mode
    process.env.CHEAP_MODE = 'true';
  }

  if (available < 0) {
    throw new Error('Claude budget exceeded for today');
  }

  return await fn();
}
```

---

### 4.2 OpenAI Budget

**Daily limit:** $10

```typescript
const PROVIDER_BUDGETS = {
  openai: {
    dailyLimit: 10,
    perCallLimit: 0.01,
    defaultModel: 'gpt-4o-mini',
  },
};
```

---

## Monitoring Provider Health

```
Provider Health Dashboard
═════════════════════════════════════════════════════════

Claude API:
  ├─ Status:        🟢 Healthy
  ├─ Latency p95:   1.2s
  ├─ Error rate:    < 0.1%
  ├─ Throttle count: 0 (today)
  └─ Cost (today):  $32.40 / $50

OpenAI API:
  ├─ Status:        🟢 Healthy
  ├─ Latency p95:   300ms
  ├─ Error rate:    < 0.05%
  ├─ Rate limit hits: 0 (today)
  └─ Cost (today):  $4.20 / $10

Embeddings:
  ├─ Status:        🟢 Healthy
  ├─ Cache hit rate: 92%
  ├─ Fresh requests: 143 (today)
  └─ Cost (today):  $0.08 / $10
```

---

## Provider Evolution (Future)

| Phase | Timeline | Change |
|---|---|---|
| **Current** | May 2026 | Claude + OpenAI |
| **Phase 2** | Aug 2026 | Add Llama fallback (local) |
| **Phase 3** | Q4 2026 | Fine-tune Llama for outreach |
| **Phase 4** | Q1 2027 | Self-hosted inference (cost -70%) |

---

## Conclusion

**Provider strategy summary:**
- **Claude:** Strategic reasoning, brand voice, personalization
- **OpenAI:** Structured output, parsing, embeddings
- **Fallback:** Cached responses, local models, deterministic logic
- **Cost discipline:** Strict budgets, avoid overlap, monitor continuously

**Golden rule:** Don't pay Claude prices for OpenAI work. Don't pay API prices for cached results.

**Monthly savings potential:** 60-70% with disciplined provider selection.
