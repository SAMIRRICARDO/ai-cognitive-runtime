# VRASHOWS Outbound Metrics & SLAs

## Overview

Definição clara de SLAs operacionais, KPIs de outreach e thresholds para monitoramento contínuo do VRASHOWS pipeline de email.

---

## Current Safe Envelope

```
Single deployment (1x Node.js):
  - Max leads/day: 10,000
  - Max outreach/day: 50
  - Max emails/hour: 10
  - Target reply rate: 5-10%
  - Target bounce rate: < 5%
  - Target spam complaint: < 0.1%
  - Reliability: 99% (single PoF)
  - Daily cost: $5-50
```

---

## Core KPIs

### 1. Lead Metrics

#### 1.1 Leads Acquired (Daily Target)

| Metric | Target | Yellow | Red |
|---|---|---|---|
| **Leads/day** | 100-500 | 50-100 | < 50 |
| **Unique companies** | 50-200 | 25-50 | < 25 |
| **Decision makers** | 150-400 | 75-150 | < 75 |
| **Valid emails** | 80%+ | 60-80% | < 60% |

**Monitoring:**
```typescript
async function trackLeadMetrics() {
  const today = new Date().toISOString().split('T')[0];
  const metrics = {
    acquired: await countLeadsAcquired(today),
    companies: await countUniqueCompanies(today),
    decisionMakers: await countDecisionMakers(today),
    validEmails: await percentValidEmails(today),
  };

  if (metrics.acquired < 50) {
    await slack.send('#ops', '⚠️ Low lead acquisition', metrics);
  }
}
```

---

#### 1.2 Lead Quality Score

| Score | Rating | Action |
|---|---|---|
| **0.7-1.0** | 🟢 HOT | Send immediately |
| **0.5-0.7** | 🟡 WARM | Queue for personalization |
| **0.3-0.5** | 🟠 LOW_PRIORITY | Batch send, low volume |
| **0.0-0.3** | 🔴 REJECT | Do not send |

**Score Components:**
- Company fit (market, size, industry): 30%
- Contact seniority (C-level, VP): 25%
- Email validity (format, verification): 20%
- Industry alignment: 15%
- Recent activity signals: 10%

---

### 2. Outreach Metrics

#### 2.1 Sends & Delivery

| Metric | Target | Yellow | Red |
|---|---|---|---|
| **Sends/day** | 50-200 | 25-50 | < 25 |
| **Successful delivery** | > 95% | 90-95% | < 90% |
| **Bounce rate** | < 5% | 5-10% | > 10% |
| **Spam complaints** | < 0.1% | 0.1-0.5% | > 0.5% |

**Delivery SLA:**
```
Target: 95%+ of sends reach inbox (not spam/bounce)
Acceptable: 90-95%
Unacceptable: < 90% (investigate immediately)
```

---

#### 2.2 Email Quality

| Metric | Target | Yellow | Red |
|---|---|---|---|
| **Avg quality score** | > 75% | 60-75% | < 60% |
| **Personalisation score** | > 80% | 60-80% | < 60% |
| **Subject line CTR** | > 25% | 15-25% | < 15% |

**Quality Scoring Dimensions:**
- Subject relevance: Is it compelling?
- Body personalization: Is it unique to recipient?
- CTA clarity: Is next step obvious?
- Brand alignment: VRASHOWS voice?
- Length: Too long/short?
- Tone: Appropriate to audience?

---

### 3. Engagement Metrics

#### 3.1 Reply Rate (Opens → Replies)

| Segment | Target | Acceptable | Below Target |
|---|---|---|---|
| **HOT leads** | 15-25% | 10-15% | < 10% |
| **WARM leads** | 5-10% | 3-5% | < 3% |
| **LOW leads** | 1-3% | 0.5-1% | < 0.5% |
| **Overall** | 8-15% | 5-8% | < 5% |

**Reply Tracking:**
```typescript
async function trackReplyRate(period: string) {
  const sent = await emailService.countSent(period);
  const opened = await emailService.countOpened(period);
  const replied = await emailService.countReplied(period);

  const openRate = opened / sent;
  const replyRate = replied / sent;

  if (replyRate < 0.05) {
    await alert('Low reply rate detected', { sent, replied, replyRate });
  }
}
```

---

#### 3.2 Bounce & Complaint Rates

| Metric | SLA | Alert Threshold |
|---|---|---|
| **Hard bounce** | < 2% | > 5% |
| **Soft bounce** | < 3% | > 7% |
| **Spam complaints** | < 0.05% | > 0.1% |
| **List unsubscribe** | < 1% | > 3% |

**Bounce Recovery:**
```
Hard bounce (invalid address):
  - Remove from future sends
  - Log with lead ID
  - Trigger re-enrichment if possible

Soft bounce (temporary issue):
  - Retry in 24 hours (up to 3 times)
  - After 3 retries, treat as hard bounce

Complaint:
  - Immediately remove from list
  - Alert to ops
  - Review email content
```

---

### 4. Cost Metrics

#### 4.1 Cost Per Lead

| Phase | Target | Acceptable | Over Budget |
|---|---|---|---|
| **Acquisition** | $0.50-2.00 | $2-5 | > $5 |
| **Enrichment** | $0.20-0.50 | $0.50-1.00 | > $1.00 |
| **Outreach** | $0.30-0.70 | $0.70-1.50 | > $1.50 |
| **Total per lead** | $1.00-3.20 | $3-7 | > $7 |

**Cost Breakdown (Daily):**
```
Leads acquired: 200
├─ Claude research: 200 * $0.003 = $0.60
├─ OpenAI enrichment: 200 * $0.0002 = $0.04
├─ Outreach generation: 50 * $0.005 = $0.25
├─ Email delivery: 50 * $0.001 = $0.05
└─ Memory & retrieval: $0.10

Total/day: ~$1.04
Per lead: ~$0.006
```

---

#### 4.2 Daily Budget

| Envelope | Daily Budget | Spend Limit | Alert |
|---|---|---|---|
| **MVP** | $10-30 | $30 | > $30 |
| **Scale** | $50-100 | $150 | > $150 |
| **Enterprise** | $200-500 | $750 | > $750 |

**Daily Cost Dashboard:**
```
Today's Spend: $43.20 (of $500 daily budget)
├─ Claude API:     $28.50  (66%)
├─ OpenAI:         $12.30  (28%)
├─ Resend:         $2.40   (6%)
└─ Infrastructure: $0.00

Trend (7-day avg): $45.32/day
Projected (month): $1,359.60
```

---

## Operational SLAs

### 5.1 System Uptime

| Service | Target | Acceptable | Action |
|---|---|---|---|
| **Agent execution** | 99.9% | 99% | Page on-call |
| **Email delivery** | 99.5% | 98% | Page on-call |
| **Memory retrieval** | 99.5% | 98% | Degrade gracefully |
| **Redis cache** | 99.9% | 99% | Failover to replica |
| **PostgreSQL** | 99.9% | 99% | Failover to replica |

---

### 5.2 Latency SLAs

| Operation | p50 | p95 | p99 | SLA |
|---|---|---|---|---|
| **Lead scoring** | 100ms | 500ms | 1s | < 500ms p95 |
| **Email generation** | 2s | 5s | 10s | < 5s p95 |
| **Memory retrieval** | 50ms | 200ms | 500ms | < 200ms p95 |
| **Email send** | 1s | 3s | 5s | < 3s p95 |

---

### 5.3 Accuracy SLAs

| Metric | Target | Acceptable | Below Target |
|---|---|---|---|
| **Lead validation** | > 90% | 80-90% | < 80% |
| **Email format** | > 95% | 90-95% | < 90% |
| **Company match** | > 85% | 75-85% | < 75% |
| **Email prediction** | > 70% | 60-70% | < 60% |

---

## Warming & Ramp-Up Strategy

### Domain Warming (New Domain)

**Phase 1: Days 1-5**
- Max 20 sends/day
- Monitor bounce rate closely
- All sends to seed addresses (known good)
- Expect 0% bounce rate

**Phase 2: Days 6-14**
- Increase to 50 sends/day
- Mix of seed + real addresses
- Monitor complaints
- Target: < 1% bounce rate

**Phase 3: Days 15-30**
- Increase to 200 sends/day
- 100% real audience
- Full monitoring active
- Target: < 5% bounce rate

**Phase 4: Month 2+**
- Scale to production envelope (500+/day)
- Continuous monitoring
- Maintain SLAs

---

### Safe Scaling Envelope

```
Week 1:  50 sends    (7/day avg)
Week 2:  200 sends   (28/day avg)
Week 3:  500 sends   (70/day avg)
Week 4:  1000 sends  (140/day avg)
Month 2: 3000 sends  (100/day avg)
Month 3: 10000 sends (330/day avg)

Key checkpoints:
├─ After 1K sends: validate bounce rate < 5%
├─ After 5K sends: validate complaint rate < 0.1%
├─ After 10K sends: ready for production envelope
```

---

## Monitoring & Alerting

### Real-Time Dashboard

```
VRASHOWS OUTBOUND METRICS (Real-time)
═══════════════════════════════════════════════════════

DAILY SENDS
  Today:       45/50  (90%)
  Week avg:    42/day
  Target:      50/day

QUALITY
  Avg score:   78% (🟢 good)
  Bounce:      2.3% (🟢 good)
  Complaints:  0.02% (🟢 good)

ENGAGEMENT
  Opens:       18/45  (40%)
  Replies:     4/45   (8.9%)
  Target reply: 10%   (slightly below)

COST
  Daily:       $42.10 (of $500)
  Per lead:    $0.94
  Trend:       stable

ALERTS
  ⚠️  Reply rate slightly below target (8.9% vs 10%)
  ✅ All other metrics healthy
```

---

### Alert Rules

| Alert | Condition | Severity | Action |
|---|---|---|---|
| Low sends | < 20 sends/day | 🟡 HIGH | Notify ops |
| High bounce | > 10% | 🔴 CRITICAL | Block sends, investigate |
| High complaints | > 0.5% | 🔴 CRITICAL | Block sends, investigate |
| Low reply | < 3% (vs 8% target) | 🟡 HIGH | Review content |
| Cost spike | > 2x daily avg | 🔴 CRITICAL | Page ops, investigate |
| Delivery delay | > 30 min | 🟡 MEDIUM | Check Resend status |

---

## Monthly SLA Report Template

```
═════════════════════════════════════════════════════════
         VRASHOWS OUTREACH SLA REPORT (May 2026)
═════════════════════════════════════════════════════════

OVERVIEW
--------
Period:        May 1-31, 2026
Uptime:        99.7% ✅
SLA Target:    99.5%
Status:        PASSING

DELIVERY METRICS
────────────────
Total sent:           12,450
Delivered:            11,827 (95.0%) ✅
Hard bounced:         413 (3.3%) ✅
Soft bounced:         210 (1.7%) ✅

QUALITY METRICS
───────────────
Avg quality score:    76% ✅
Avg personalization:  82% ✅
Subject CTR:          28% ✅

ENGAGEMENT METRICS
──────────────────
Opens:                4,852 (39.0%)
Replies:              1,098 (8.8%) ✅
Complaints:           12 (0.1%) ✅

COST METRICS
────────────
Total spend:          $875.43
Per lead:             $0.070 ✅
Daily avg:            $28.20

INCIDENTS
─────────
- May 15: Resend API timeout (15 min) — no impact
- No other incidents

SUMMARY
───────
All SLAs met. System performing well.
Recommended: Continue current scale, monitor reply rate.

SIGNED: Platform Team
DATE: June 1, 2026
═════════════════════════════════════════════════════════
```

---

## Conclusion

Métricas claras habilitam operação data-driven e confiável. Monitore religiosamente; alertas falsos são melhores que surpresas.

**Compliance Checklist:**
- [ ] All KPIs defined and tracked
- [ ] SLA targets communicated to stakeholders
- [ ] Alert rules configured in monitoring system
- [ ] Dashboard deployed and accessible
- [ ] Team trained on metrics interpretation
- [ ] Monthly review process scheduled
