# ADR-003: Decision Engine Calibration — Gate Integrity

**Status:** Accepted  
**Date:** 2026-07-15  
**Author:** Engineering  

---

## Context

VRAXIA WORK is designed to maximize interview conversion rate, not application volume.
The Hire Intelligence Engine (HIE) gates automatic submissions behind a single consolidated
metric: `interviewProbability >= HIRE_THRESHOLD (90)`.

Dashboard observation: the system was applying to jobs that did not represent genuine
high-confidence opportunities, and REVIEW-status jobs were visually indistinguishable
from APPLY-pending jobs.

Empirical baseline from `decisions.jsonl` (70 decisions):
- APPLY: 0 — REVIEW: 0 — SKIP: 70 (100%)
- IP range: 0–72, avg 43.7
- HS range: 9–81, avg 51.6
- Competition: 83% "high" → −12 penalty correctly applied

---

## Problem

Five independent calibration defects caused the scoring model to produce inflated
`hireScore` / `interviewProbability` values, enabling borderline jobs to cross the
APPLY threshold under specific conditions:

### Defect 1 — `fallbackRaw` multipliers were inflated
**File:** `src/agents/HireScoreAgent.ts`, `fallbackRaw()`

```typescript
// BEFORE
const atsPct  = Math.min(100, Math.round((hits  / total) * 200)); // 50% → 100
const techFit = Math.min(100, Math.round((techHit / total) * 140)); // 71% → 100
```

When the LLM call threw (network error, rate limit), the fallback path produced
scores significantly higher than the LLM would have for the same job.
A fallback is expected to be MORE conservative, not more permissive.

### Defect 2 — Unknown salary and location assumed favorable
**File:** `src/agents/HireScoreAgent.ts`, `callLLM()`

```typescript
// BEFORE
salaryFit:   parsed.salaryFit  ?? 75,  // +11.25 pts to hireScore
locationFit: parsed.locationFit ?? 80,  // +4 pts to hireScore
```

Most Brazilian job postings do not disclose salary. `unknown ≠ favorable`.
Combined: +15.25 pts of evidence-free score.

### Defect 3 — Unknown publication age received a bonus
**File:** `src/agents/HireScoreAgent.ts`, `estimatePublicationAge()`

```typescript
// BEFORE
if (!postedAt) return 3; // pubPenalty = +3 (bonus)
```

A job without a posting date could be a stale evergreen posting.
Unknown age should not confer a freshness bonus.

### Defect 4 — historicalScore defaulted to 50 with no evidence
**File:** `src/agents/HireScoreAgent.ts`, `computeHistoricalScore()`

```typescript
// BEFORE
if (!patterns.length) return 50; // adds 5 pts with zero evidence
```

At system inception (no learning data), every job received 5 pts of historical
credit that no application history justified.

### Defect 5 — REVIEW jobs stored as `'queued'` — dashboard perception
**File:** `src/cli/hunt.ts`, `processJob()` and LinkedIn inline flow

```typescript
// BEFORE
status: hireScore.action === 'SKIP' ? 'filtered_out' : 'queued'
```

`REVIEW` and `APPLY` both resolved to `status='queued'`.
The dashboard could not distinguish "will be submitted automatically" from
"held for manual review — will NOT be submitted". The `score_action` column
correctly stored `'REVIEW'` but the `status` column misled.

---

## Decision

Correct all five defects while preserving:
- All frontend contracts, API schemas, response models
- All database column names and types
- All scoring weights and thresholds (`HIRE_THRESHOLD=90`, `REVIEW_THRESHOLD=75`)
- The consolidated gate (`interviewProbability >= HIRE_THRESHOLD`)

### Changes Applied

| # | File | Function | Before | After |
|---|------|----------|--------|-------|
| 1 | `HireScoreAgent.ts` | `fallbackRaw()` | `atsPct ×200`, `techFit ×140`, `competitionLevel='medium'`, `salaryFit=75`, `locationFit=80` | `atsPct ×100`, `techFit ×100`, `competitionLevel='high'`, `salaryFit=50`, `locationFit=50` |
| 2 | `HireScoreAgent.ts` | `callLLM()` | `salaryFit ?? 75`, `locationFit ?? 80` | `salaryFit ?? 50`, `locationFit ?? 50` |
| 3 | `HireScoreAgent.ts` | `estimatePublicationAge()` | `return 3` (default) | `return 5` (neutral: pubPenalty=0) |
| 4 | `HireScoreAgent.ts` | `computeHistoricalScore()` | `return 50` | `return 30` |
| 5a | `hunt.ts` | `processJob()` upsert | `'filtered_out' if SKIP else 'queued'` | `'filtered_out'` for SKIP and REVIEW |
| 5b | `hunt.ts` | `processJob()` updateState | REVIEW → `'queued'` | REVIEW → `'cancelled'` |
| 5c | `hunt.ts` | LinkedIn inline updateState | REVIEW → `'queued'` | REVIEW → `'cancelled'` |
| 6 | `hire-intelligence.ts` | `HireScore.action` comment | `// APPLY if hireScore >= HIRE_THRESHOLD` | `// APPLY if interviewProbability >= HIRE_THRESHOLD` |

---

## Consequences

### Quantitative impact on `interviewProbability`

For a typical job with unknown salary/location and no learning history:

| Component | Before | After | Delta |
|---|---|---|---|
| `salaryFit` default contribution | `75 × 0.15 = 11.25` | `50 × 0.15 = 7.50` | −3.75 |
| `locationFit` default contribution | `80 × 0.05 = 4.00` | `50 × 0.05 = 2.50` | −1.50 |
| `historicalScore` default | `50 × 0.10 = 5.00` | `30 × 0.10 = 3.00` | −2.00 |
| `pubPenalty` (postedAt unknown) | `+3` | `0` | −3.00 |
| **Total IP reduction** | | | **−10.25** |

A job that scored IP=90 (marginal APPLY) under the old calibration
now scores IP≈80 (REVIEW) and does not receive an automatic submission.

### Gate behavior post-fix (simulation)

| Scenario | IP Before | IP After | Action |
|---|---|---|---|
| Perfect match, fresh (<24h), low comp | ~100 | 96 | ✅ APPLY |
| Excellent match, 1d, medium comp | ~91 | 84 | 🟡 REVIEW |
| Good match, 3d, high comp, unkn salary | ~76 | 64 | ❌ SKIP |
| Typical observed job (decisions.jsonl avg) | ~57 | 47 | ❌ SKIP |
| Fallback: 50% ATS coverage, high comp | ~82 | 44 | ❌ SKIP |

### Dashboard perception

REVIEW jobs now persist as `application_state='cancelled'` / `status='filtered_out'`.
The `score_action` column retains `'REVIEW'`, allowing the dashboard to
surface them as "reviewed but not submitted" if it reads `score_action`.
No job with REVIEW-level confidence can appear as a pending submission.

---

## Alignment with Product Strategy

The optimization target is **interview conversion rate**, not application volume.

Every change in this ADR makes the gate harder to cross with inflated or
assumed-favorable inputs. Genuine high-probability jobs (near-perfect technical
alignment, declared salary match, fresh posting, low competition) still reach
APPLY. Borderline jobs that relied on favorable defaults or inflated fallback
scores now correctly stay in REVIEW or SKIP.

The system now behaves as an experienced executive recruiter who only submits
when the probability of a callback is genuinely high — not as a volume optimizer
that applies to marginal opportunities to fill daily quotas.
