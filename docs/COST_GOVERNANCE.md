# VRASHOWS Cost Governance & Optimization

## Overview

Framework para controlar, monitorar e otimizar custos do VRASHOWS AI Runtime em produção.

---

## Cost Breakdown (By Component)

```
Monthly Cost (10K leads):
├─ Claude API           $50-100  (70-80%)
│  ├─ Outreach generation
│  ├─ Company research
│  └─ Personalization
├─ OpenAI API           $5-15    (8-15%)
│  ├─ Email validation
│  ├─ Lead scoring
│  └─ Embeddings
├─ Email Delivery       $10-20   (5-10%)
│  └─ Resend (0.001 per send)
├─ Infrastructure       $50-100  (8-15%)
│  ├─ Redis (cache)
│  ├─ PostgreSQL (memory)
│  └─ Compute (workers)
└─ Monitoring          $10-50    (2-5%)
   ├─ Observability
   └─ Logging

Total: $125-285/month (or $0.012-0.028 per lead)
```

---

## Cost Governance Layers

### Layer 1: Budget Enforcement

**Daily budgets by provider:**

```typescript
// config/cost-governance.ts
export const COST_LIMITS = {
  daily: {
    claude: 50,        // $50/day
    openai: 10,        // $10/day
    resend: 20,        // $20/day
    total: 500,        // $500/day hard cap
  },
  monthly: {
    claude: 1000,
    openai: 250,
    resend: 400,
    total: 2000, // $2000/month budget
  },
};

async function checkDailyBudget() {
  const today = new Date().toISOString().split('T')[0];
  
  for (const [provider, limit] of Object.entries(COST_LIMITS.daily)) {
    const spent = await redis.get(`cost:${provider}:${today}`) || 0;
    
    if (spent > limit * 0.8) {
      await slack.warn(`${provider} at 80% of daily budget ($${spent}/$${limit})`);
    }
    
    if (spent > limit) {
      await emergencyShutdown(`${provider} daily budget exceeded`);
    }
  }
}

// Run every minute
setInterval(checkDailyBudget, 60000);
```

---

### Layer 2: Per-Agent Budget

```typescript
export const AGENT_DAILY_BUDGETS = {
  'futurecom-researcher': 15,
  'lead-enrichment': 10,
  'outreach-generator': 20,
  'email-sender': 3,
  'memory-manager': 2,
};

async function checkAgentBudget(agentName: string, costIncrement: number) {
  const today = new Date().toISOString().split('T')[0];
  const key = `cost:agent:${agentName}:${today}`;
  const spent = parseFloat(await redis.get(key) || '0');
  const budget = AGENT_DAILY_BUDGETS[agentName];

  if (spent + costIncrement > budget) {
    logger.warn(`Agent ${agentName} budget limit reached`, {
      spent: spent + costIncrement,
      budget,
    });
    throw new Error(`Agent budget exceeded: ${agentName}`);
  }

  await redis.incrby(key, costIncrement);
}
```

---

### Layer 3: Request-Level Cost Cap

**Never allow a single API call to cost more than $1:**

```typescript
// agents/_base/agent.ts
async function executeWithCostCap(input: string): Promise<string> {
  const estimatedTokens = this.estimateTokenCount(input);
  const estimatedCost = (estimatedTokens / 1000000) * this.costPerMToken;

  if (estimatedCost > 1.0) {
    throw new Error(`Request cost estimate exceeds cap ($${estimatedCost})`);
  }

  return await this._execute(input);
}

function estimateTokenCount(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}
```

---

## Cost Optimization Strategies

### Strategy 1: Cache Aggressively

**Cache hit rate target:** 80%+

```typescript
// Every API call should check cache first
async function getCompanyInfo(companyId: string): Promise<CompanyInfo> {
  // Try cache (Redis, 24h TTL)
  const cached = await redis.get(`company:${companyId}`);
  if (cached) {
    metrics.cacheHit.inc();
    return JSON.parse(cached);
  }

  // Cache miss: fetch from API
  metrics.cacheMiss.inc();
  const info = await claude.getCompanyResearch(companyId);
  
  // Store for 24 hours
  await redis.setex(`company:${companyId}`, 86400, JSON.stringify(info));
  
  return info;
}

// Target: 80% of requests are cache hits (cost reduction: 80%)
```

---

### Strategy 2: Use Cheap Mode for Low-Risk Tasks

**When to use cheap mode:**

```typescript
// config/cheap-mode.ts
const CHEAP_MODE_ELIGIBLE = {
  'email-validation': true,     // Deterministic, safe to cut costs
  'lead-scoring': true,         // Structured data, safe
  'contact-enrichment': true,   // Fallback available, safe
  'outreach-generation': false, // High-risk, quality matters
  'company-research': false,    // Strategic, need quality
};

async function executeWithSmartCheapMode(agentName: string, fn: () => Promise<any>) {
  const todaysCost = await redis.get(`cost:daily:${new Date().toISOString().split('T')[0]}`) || 0;
  
  const shouldUseCheapMode = 
    parseFloat(todaysCost) > 400 || // Already spent $400+
    CHEAP_MODE_ELIGIBLE[agentName]; // Or always cheap for safe tasks

  if (shouldUseCheapMode) {
    process.env.CHEAP_MODE = 'true';
  }

  return await fn();
}
```

**Cost savings: 60-70% for eligible tasks**

---

### Strategy 3: Batch Processing

**Instead of 1 API call per lead, batch 100 leads:**

```typescript
// tools/batch-executor.ts
async function batchEnrichLeads(leads: Lead[], batchSize = 100): Promise<Lead[]> {
  const enriched = [];

  for (let i = 0; i < leads.length; i += batchSize) {
    const batch = leads.slice(i, i + batchSize);
    
    // Single prompt handles 100 leads
    const result = await claude.enrichBatch(batch);
    enriched.push(...result);

    // Cost: 1 API call for 100 leads vs 100 API calls
    // Savings: 99% for this operation
  }

  return enriched;
}
```

**Cost savings: 50-80%**

---

### Strategy 4: Selective Vector Retrieval

**Don't inject all memory; select top 3 relevant chunks:**

```typescript
// memory/retrieval.ts
async function selectRelevantMemory(leadId: string, limit = 3): Promise<string> {
  // Retrieve top K=10 candidates
  const candidates = await postgres.vectorSearch(leadId, { limit: 10 });

  // Rank by relevance and take top 3
  const selected = candidates
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit)
    .map(m => m.content)
    .join('\n\n');

  // Only inject top 3 (vs all 10)
  // Cost: -70% context tokens

  return selected;
}
```

**Cost savings: 40-60% of context tokens**

---

### Strategy 5: Response Compression

```typescript
// agents/_base/agent.ts
async function compressResponse(response: string, maxTokens = 1000): Promise<string> {
  // If response is already short, no compression needed
  if (response.length < maxTokens * 4) {
    return response;
  }

  // Compress by summarization (using cheap model)
  const compressed = await cheapModel.summarize(response, {
    maxTokens,
  });

  return compressed;
}
```

**Cost savings: 20-40% of output tokens**

---

## Real-Time Cost Dashboard

```
VRASHOWS COST DASHBOARD (Real-time)
═════════════════════════════════════════════════════════

TODAY'S SPENDING: $127.40 / $500.00 (25%)
├─ Claude API:     $95.30  (75%)
├─ OpenAI API:     $28.10  (22%)
├─ Resend:         $3.50   (3%)
└─ Infrastructure: $0.50   (< 1%)

BUDGET STATUS
├─ Daily budget:   ✅ OK (75% remaining)
├─ Weekly pace:    ⚠️  High ($890/week → $3,560/month vs $2,000 budget)
└─ Monthly rate:   🔴 Exceed budget at current pace

COST BY AGENT (Today)
├─ Outreach:       $60.20  (47%)
├─ Enrichment:     $42.10  (33%)
├─ Research:       $20.00  (16%)
├─ Scoring:        $4.50   (3%)
└─ Other:          $0.60   (< 1%)

EFFICIENCY METRICS
├─ Cache hit rate:       82% 🟢
├─ Avg cost per lead:    $0.0128
├─ Cost per outcome:     $8.50 (per email sent)
└─ ROI estimate:         $2-5 per dollar spent

RECOMMENDATIONS
⚠️  Weekly pace exceeds monthly budget. Actions:
  1. Increase cache aggressiveness (target 85%+)
  2. Enable cheap mode for low-risk tasks
  3. Reduce memory injection size
  4. Batch processing for enrichment

FORECAST
├─ At current rate: $3,820/month (190% of budget)
├─ With optimization: $1,900/month (95% of budget)
└─ With all optimizations: $1,200/month (60% of budget)
```

---

## Cost Tracking Implementation

### 4.1 Tagging API Calls

```typescript
// Every API call must be tagged with metadata
async function claudeCall(params: any) {
  const startTime = Date.now();
  const response = await claude.messages.create({
    ...params,
    metadata: {
      agent: 'lead-enrichment',
      operation: 'enrich_lead',
      leadId: '123',
    },
  });

  const duration = Date.now() - startTime;
  const cost = calculateCost(response.usage);

  // Record cost
  const today = new Date().toISOString().split('T')[0];
  await redis.incrbyfloat(`cost:daily:${today}`, cost);
  await redis.incrbyfloat(`cost:agent:lead-enrichment:${today}`, cost);
  await redis.incrbyfloat(`cost:model:claude:${today}`, cost);

  // Log for analysis
  logger.info('API call completed', {
    agent: 'lead-enrichment',
    operation: 'enrich_lead',
    duration,
    cost,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  return response;
}
```

### 4.2 Cost Report Generation

```bash
# Generate weekly cost report
npm run cost:report -- --period=weekly --email=team@example.com

# Generate monthly forecast
npm run cost:forecast -- --period=monthly

# Analyze cost by agent
npm run cost:by-agent -- --agent=outreach

# Find top cost consumers
npm run cost:top-10
```

---

## Cost Optimization Roadmap

| Phase | Timeline | Optimization | Savings |
|---|---|---|---|
| **Current** | May | Baseline (no optimization) | — |
| **Quick Wins** | June | Cache + cheap mode | -30% |
| **Medium-Term** | July | Batching + compression | -50% |
| **Long-Term** | Aug+ | Self-hosted inference | -70% |

---

## Monthly Cost Reduction Targets

```
May 2026 (Baseline):
  Leads: 1,000
  Cost: $300
  Per lead: $0.30

June (With optimization):
  Leads: 2,000
  Cost: $250 (target)
  Per lead: $0.125 (-58%)

July (With batching):
  Leads: 5,000
  Cost: $350 (target)
  Per lead: $0.070 (-76%)

August (Scale to 10K):
  Leads: 10,000
  Cost: $600 (target)
  Per lead: $0.060 (-80% vs baseline)
```

---

## Cost Accountability

### 6.1 Budget Owner

| Component | Owner | Alert Threshold |
|---|---|---|
| Claude budget | VP Engineering | 70% of daily |
| OpenAI budget | VP Engineering | 80% of daily |
| Infrastructure | DevOps | 60% of monthly |
| **Total** | **Finance** | **$300/day** |

---

### 6.2 Monthly Review

```
Cost Review Meeting (Last Friday of Month)
═════════════════════════════════════════════════════════

Attendees: Finance, Engineering, Product
Duration: 30 min

Agenda:
1. Monthly spending summary
2. Cost per KPI (cost per lead, per email, per outcome)
3. Optimization wins (caching, batching, etc)
4. Forecast vs budget
5. Action items for next month

Sample Output:
─────────────────────────────────────
May 2026 Cost Review
─────────────────────────────────────
Actual spend:    $1,847 (92% of $2,000 budget) ✅
Leads processed: 12,400
Cost per lead:   $0.149 (target: $0.15) ✅

Optimizations applied:
├─ Cache hit rate improved 78% → 84% (-$80)
├─ Cheap mode for scoring (-$120)
└─ Batching enrichment (-$150)

Total savings:   -$350 vs unoptimized run

Forecast (June):
├─ Planned leads: 15,000
├─ Estimated cost: $2,100 (105% of budget) ⚠️
└─ Recommended action: Increase batch size

Action items:
1. [DONE] Implement selective memory injection
2. [PENDING] Enable cheap mode by default for low-risk tasks
3. [PENDING] Add cost warnings to agent logs
4. [NEW] Investigate why enrichment cost 30% higher than expected
```

---

## Cost Emergency Procedures

### 7.1 Cost Spike (2x Expected)

**Trigger:** Daily cost > 2x rolling 7-day average

**Action:**
1. [ ] Page on-call engineer
2. [ ] Check agent logs for anomalies
3. [ ] Verify no runaway loops
4. [ ] Check for unusual lead volume
5. [ ] Enable aggressive cheap mode
6. [ ] Pause lower-priority agents
7. [ ] Analyze root cause

```bash
# Emergency: Reduce spending by 50%
export CHEAP_MODE=true
export MAX_ITERATIONS=3
export CACHE_ONLY=true
npm run scripts/run-agent.ts researcher
```

---

### 7.2 Monthly Budget Exceeded

**Trigger:** Month-to-date spending > monthly budget

**Action:**
1. [ ] Finance notified immediately
2. [ ] Pause non-critical campaigns
3. [ ] Review next month forecast
4. [ ] Request budget increase or reduce scope
5. [ ] Post-mortem analysis

---

## Conclusion

Disciplina de custos é crítica para operação sustentável. Sem controle rigoroso, custos crescem exponencialmente.

**Cost Governance Checklist:**
- [ ] Daily budgets set per provider
- [ ] Per-agent budgets tracked
- [ ] Per-request cost caps enforced
- [ ] Cache targets (80%+ hit rate)
- [ ] Cheap mode strategy implemented
- [ ] Cost dashboard visible to team
- [ ] Monthly review process
- [ ] Emergency procedures documented
- [ ] Forecasting system in place
- [ ] Cost optimization roadmap active

**Target: Keep per-lead cost < $0.10**
