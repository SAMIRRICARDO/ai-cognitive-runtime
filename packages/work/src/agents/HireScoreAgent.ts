// packages/work/src/agents/HireScoreAgent.ts
// Hire Intelligence Engine — computes Interview Probability and Hire Score.
//
// Primary question: "What is the probability this application generates an interview?"
// NOT: "Does this job match the profile?" (that's the old MatchAgent question)
//
// Upgrade from MatchAgent:
//   MatchAgent → "Does this job fit me?" → threshold 75
//   HireScoreAgent → "Will this job call me back?" → threshold 90

import Anthropic from '@anthropic-ai/sdk';
import type { Job } from '../types/index.js';
import { claudeMaxTokens, claudeModel } from '../claude-budget.js';
import {
  HireScore,
  ProfessionalTwin,
  LearningPattern,
  HIRE_THRESHOLD,
  REVIEW_THRESHOLD,
  COMPETITION_PENALTY,
  HIE_SCORE_WEIGHTS,
  type CompetitionLevel,
  type TwinId,
} from '../types/hire-intelligence.js';

interface HireScoreRaw {
  technicalFit: number;
  salaryFit: number;
  seniorityFit: number;
  locationFit: number;
  atsProbability: number;
  competitionLevel: CompetitionLevel;
  publicationAgeDays: number;
  reasoning: string;
  keyStrengths: string[];
  keyWeaknesses: string[];
  atsKeywordsFound: string[];
  atsKeywordsMissing: string[];
}

export class HireScoreAgent {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey });
  }

  async score(
    job: Job,
    twin: ProfessionalTwin,
    historicalPatterns: LearningPattern[] = [],
  ): Promise<HireScore> {
    const historicalScore = this.computeHistoricalScore(historicalPatterns, twin);
    const raw = await this.callLLM(job, twin);
    return this.buildHireScore(job.id, twin.id, raw, historicalScore);
  }

  private async callLLM(job: Job, twin: ProfessionalTwin): Promise<HireScoreRaw> {
    const pubAge = this.estimatePublicationAge(job.postedAt);

    const prompt = `You are a hiring intelligence model. Your task is NOT to say if this job fits the candidate — your task is to predict the probability that this application will result in an interview call.

Consider: competition volume, how well the candidate's profile stands out, ATS keyword coverage, seniority alignment, and realistic salary expectations.

CANDIDATE TWIN: ${twin.label}
- Headline: ${twin.headline}
- Primary stack: ${twin.primaryStack.join(', ')}
- ATS keywords available: ${twin.atsKeywords.slice(0, 15).join(', ')}
- Target roles: ${twin.targetRoles.slice(0, 4).join(', ')}
- Target salary (BRL): R$ ${twin.targetSalary.toLocaleString()}
- Seniority: ${twin.targetSeniority}

JOB:
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location}
- Platform: ${job.platform ?? 'unknown'}
- Posted ~${pubAge} days ago
- Description: ${job.description.slice(0, 2200)}

Assess:
1. technicalFit (0-100): stack + skills alignment
2. salaryFit (0-100): salary range vs target (assume competitive if not stated — 75)
3. seniorityFit (0-100): experience level match (15 years, architect/lead)
4. locationFit (0-100): remote/hybrid/onsite fit (candidate is flexible, prefers remote)
5. atsProbability (0-100): % of JD keywords covered by candidate's ATS keywords list
6. competitionLevel: "low"|"medium"|"high"|"very_high" (estimate based on role, company, platform)
7. publicationAgeDays: ${pubAge} (already calculated — include as-is)

Return ONLY this JSON:
{
  "technicalFit": <0-100>,
  "salaryFit": <0-100>,
  "seniorityFit": <0-100>,
  "locationFit": <0-100>,
  "atsProbability": <0-100>,
  "competitionLevel": "<low|medium|high|very_high>",
  "publicationAgeDays": ${pubAge},
  "reasoning": "<2 sentences max: why will/won't this generate an interview>",
  "keyStrengths": ["<strength 1>","<strength 2>","<strength 3>"],
  "keyWeaknesses": ["<weakness 1>","<weakness 2>"],
  "atsKeywordsFound": ["<kw1>","<kw2>","<kw3>"],
  "atsKeywordsMissing": ["<kw1>","<kw2>"]
}`;

    try {
      const response = await this.client.messages.create({
        model: claudeModel('claude-sonnet-4-6'),
        max_tokens: claudeMaxTokens(512),
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const raw = text.replace(/```json|```/g, '').trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error(`[HireScoreAgent] JSON truncado (${response.usage?.output_tokens ?? '?'} tokens). Usando fallback.`);
        return this.fallbackRaw(job, twin, pubAge);
      }
      const parsed = JSON.parse(jsonMatch[0]);

      return {
        technicalFit:    this.clamp(parsed.technicalFit, 0, 100),
        salaryFit:       this.clamp(parsed.salaryFit ?? 50, 0, 100),   // 50=neutral when unknown
        seniorityFit:    this.clamp(parsed.seniorityFit, 0, 100),
        locationFit:     this.clamp(parsed.locationFit ?? 50, 0, 100), // 50=neutral when unknown
        atsProbability:  this.clamp(parsed.atsProbability, 0, 100),
        competitionLevel: this.validCompetition(parsed.competitionLevel),
        publicationAgeDays: pubAge,
        reasoning:        String(parsed.reasoning ?? ''),
        keyStrengths:     Array.isArray(parsed.keyStrengths) ? parsed.keyStrengths.slice(0, 5) : [],
        keyWeaknesses:    Array.isArray(parsed.keyWeaknesses) ? parsed.keyWeaknesses.slice(0, 3) : [],
        atsKeywordsFound: Array.isArray(parsed.atsKeywordsFound) ? parsed.atsKeywordsFound : [],
        atsKeywordsMissing: Array.isArray(parsed.atsKeywordsMissing) ? parsed.atsKeywordsMissing : [],
      };
    } catch {
      return this.fallbackRaw(job, twin, pubAge);
    }
  }

  private buildHireScore(
    jobId: string,
    twinId: TwinId,
    raw: HireScoreRaw,
    historicalScore: number,
  ): HireScore {
    // Weighted composite score (0–100)
    const weighted =
      raw.technicalFit   * HIE_SCORE_WEIGHTS.technicalFit +
      raw.seniorityFit   * HIE_SCORE_WEIGHTS.seniorityFit +
      raw.salaryFit      * HIE_SCORE_WEIGHTS.salaryFit +
      raw.atsProbability * HIE_SCORE_WEIGHTS.atsProbability +
      historicalScore    * HIE_SCORE_WEIGHTS.historicalScore +
      raw.locationFit    * HIE_SCORE_WEIGHTS.locationFit;

    const hireScore = this.clamp(Math.round(weighted), 0, 100);

    // Interview Probability = HireScore + competition penalty (can go lower than hireScore)
    const penalty = COMPETITION_PENALTY[raw.competitionLevel];
    // Timing penalty/bonus — publication age is one of the strongest predictors of callback rate
    const pubPenalty =
      raw.publicationAgeDays < 1  ? +8  :   // < 24h: bônus máximo
      raw.publicationAgeDays <= 3 ? +3  :   // 1-3 dias: pequeno bônus
      raw.publicationAgeDays <= 5 ?  0  :   // 3-5 dias: neutro
      raw.publicationAgeDays <= 7 ? -8  :   // 5-7 dias: penalidade moderada
      raw.publicationAgeDays <= 14? -15 :   // 1-2 semanas: penalidade alta
                                    -25;    // > 2 semanas: quasi-eliminatório
    const interviewProbability = this.clamp(Math.round(hireScore + penalty + pubPenalty), 0, 100);

    // Gate uses interviewProbability (not raw hireScore) so age+competition penalties are
    // decision-relevant, not just cosmetic. A 14-day stale job with perfect tech fit
    // still has low P(interview) — interviewProbability encodes that reality.
    const action =
      interviewProbability >= HIRE_THRESHOLD  ? 'APPLY' :
      interviewProbability >= REVIEW_THRESHOLD ? 'REVIEW' :
      'SKIP';

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3 * 86_400_000).toISOString();

    return {
      jobId,
      twinId,
      dimensions: {
        technicalFit:    raw.technicalFit,
        salaryFit:       raw.salaryFit,
        seniorityFit:    raw.seniorityFit,
        locationFit:     raw.locationFit,
        atsProbability:  raw.atsProbability,
        historicalScore,
      },
      marketContext: {
        competitionLevel:   raw.competitionLevel,
        publicationAgeDays: raw.publicationAgeDays,
        platformEaseScore:  70,
      },
      interviewProbability,
      hireScore,
      action,
      reasoning:         raw.reasoning,
      keyStrengths:      raw.keyStrengths,
      keyWeaknesses:     raw.keyWeaknesses,
      atsKeywordsFound:  raw.atsKeywordsFound,
      atsKeywordsMissing: raw.atsKeywordsMissing,
      scoredAt:  now.toISOString(),
      expiresAt,
    };
  }

  // ── Historical scoring ────────────────────────────────────────────────────

  private computeHistoricalScore(patterns: LearningPattern[], twin: ProfessionalTwin): number {
    if (!patterns.length) return 30; // conservative when no learning history yet

    // Weight patterns: twin-specific patterns are most informative
    const twinPattern = patterns.find(p => p.patternType === 'twin' && p.patternKey === twin.id);
    const stackPatterns = patterns.filter(p => p.patternType === 'stack');

    if (twinPattern && twinPattern.totalApplications >= 3) {
      // Scale interview rate (0–1) to 0–100, centered at 50
      return this.clamp(Math.round(twinPattern.interviewRate * 100 * 2.5), 0, 100);
    }

    if (stackPatterns.length) {
      const avgRate = stackPatterns.reduce((s, p) => s + p.interviewRate, 0) / stackPatterns.length;
      return this.clamp(Math.round(avgRate * 100 * 2.5), 0, 100);
    }

    return 50;
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  private estimatePublicationAge(postedAt?: string): number {
    if (!postedAt) return 5; // conservative: unknown age = neutral (0 pubPenalty), not a bonus
    try {
      const ms = Date.now() - new Date(postedAt).getTime();
      return Math.max(0, Math.round(ms / 86_400_000));
    } catch { return 3; }
  }

  private clamp(v: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, isNaN(v) ? min : v));
  }

  private validCompetition(val: string): CompetitionLevel {
    const valid: CompetitionLevel[] = ['low', 'medium', 'high', 'very_high'];
    return valid.includes(val as CompetitionLevel) ? val as CompetitionLevel : 'medium';
  }

  private fallbackRaw(job: Job, twin: ProfessionalTwin, pubAge: number): HireScoreRaw {
    const desc = `${job.title} ${job.description}`.toLowerCase();
    const hits = twin.atsKeywords.filter(k => desc.includes(k.toLowerCase())).length;
    // Linear scaling ×100: 50% coverage = 50 score (conservative fallback, not inflated)
    const atsPct = Math.min(100, Math.round((hits / Math.max(1, twin.atsKeywords.length)) * 100));

    const techHit = twin.primaryStack.filter(s => desc.includes(s.toLowerCase())).length;
    const techFit = Math.min(100, Math.round((techHit / Math.max(1, twin.primaryStack.length)) * 100));

    return {
      technicalFit:     techFit,
      salaryFit:        50,  // neutral when LLM unavailable
      seniorityFit:     70,
      locationFit:      50,  // neutral when LLM unavailable
      atsProbability:   atsPct,
      competitionLevel: 'high', // conservative: assume high competition in BR tech market
      publicationAgeDays: pubAge,
      reasoning: 'Scored via keyword matching fallback (LLM unavailable)',
      keyStrengths: twin.primaryStack.slice(0, 3),
      keyWeaknesses: [],
      atsKeywordsFound: twin.atsKeywords.filter(k => desc.includes(k.toLowerCase())).slice(0, 5),
      atsKeywordsMissing: [],
    };
  }
}
