// packages/work/src/engine/learning-engine.ts
// LearningEngine — records interview outcomes and updates LearningPatterns.
// Called after each outcome change (interview, rejection, no_response, offer, hired).
//
// Extracts pattern signals from each outcome:
//   - Which twin was used?
//   - Which stack tags appeared in the JD?
//   - Which company type / platform?
// Then updates or inserts a learning_patterns row for each signal.

import { randomUUID } from 'crypto';
import type { ProfessionalTwinsStore } from '../twin/professional-twins.js';
import type {
  InterviewOutcome,
  InterviewOutcomeType,
  PatternType,
  LearningPattern,
} from '../types/hire-intelligence.js';

export interface RecordOutcomeInput {
  jobId: string;
  twinId: InterviewOutcome['twinId'];
  company: string;
  jobTitle: string;
  platform: string;
  stackTags: string[];
  outcome: InterviewOutcomeType;
  hireScoreAtApply: number;
  interviewProbabilityAtApply: number;
  technicalFitAtApply: number;
  atsProbabilityAtApply: number;
  cvVersion?: string;
  responseTimeDays?: number;
}

export class LearningEngine {
  constructor(private store: ProfessionalTwinsStore) {}

  recordOutcome(input: RecordOutcomeInput): void {
    const now = new Date().toISOString();

    // Persist the raw outcome record
    const outcome: InterviewOutcome = {
      id: randomUUID(),
      jobId: input.jobId,
      twinId: input.twinId,
      cvVersion: input.cvVersion,
      hireScoreAtApply: input.hireScoreAtApply,
      interviewProbabilityAtApply: input.interviewProbabilityAtApply,
      technicalFitAtApply: input.technicalFitAtApply,
      atsProbabilityAtApply: input.atsProbabilityAtApply,
      outcome: input.outcome,
      outcomeRecordedAt: now,
      responseTimeDays: input.responseTimeDays,
      company: input.company,
      jobTitle: input.jobTitle,
      platform: input.platform,
      stackTags: input.stackTags,
      createdAt: now,
    };
    this.store.saveOutcome(outcome);

    // Update patterns for each signal dimension
    this.updatePattern('twin', input.twinId, input.outcome, input.hireScoreAtApply, input.responseTimeDays);
    this.updatePattern('platform', input.platform, input.outcome, input.hireScoreAtApply, input.responseTimeDays);

    for (const tag of input.stackTags.slice(0, 8)) {
      this.updatePattern('stack', tag, input.outcome, input.hireScoreAtApply, input.responseTimeDays);
    }

    // Role pattern: extract simplified role label
    const roleLabel = this.classifyRole(input.jobTitle);
    if (roleLabel) {
      this.updatePattern('role', roleLabel, input.outcome, input.hireScoreAtApply, input.responseTimeDays);
    }
  }

  private updatePattern(
    type: PatternType,
    key: string,
    outcome: InterviewOutcomeType,
    hireScore: number,
    responseTimeDays?: number,
  ): void {
    const existing = this.store.getLearningPattern(type, key);

    if (existing) {
      // Incrementally update the existing pattern
      const updated = this.applyOutcome(existing, outcome, hireScore, responseTimeDays);
      this.upsertPattern(updated);
    } else {
      // Create new pattern row
      const fresh: LearningPattern = {
        id: randomUUID(),
        patternType: type,
        patternKey: key,
        totalApplications: 0,
        interviews: 0,
        rejections: 0,
        noResponse: 0,
        offers: 0,
        interviewRate: 0,
        avgHireScore: hireScore,
        avgResponseDays: responseTimeDays,
        lastUpdated: new Date().toISOString(),
      };
      const updated = this.applyOutcome(fresh, outcome, hireScore, responseTimeDays);
      this.upsertPattern(updated);
    }
  }

  private applyOutcome(
    p: LearningPattern,
    outcome: InterviewOutcomeType,
    hireScore: number,
    responseTimeDays?: number,
  ): LearningPattern {
    const total = p.totalApplications + 1;
    const interviews  = p.interviews   + (outcome === 'interview' || outcome === 'offer' || outcome === 'hired' ? 1 : 0);
    const rejections  = p.rejections   + (outcome === 'rejection' ? 1 : 0);
    const noResponse  = p.noResponse   + (outcome === 'no_response' || outcome === 'ghosted' ? 1 : 0);
    const offers      = p.offers       + (outcome === 'offer' || outcome === 'hired' ? 1 : 0);

    // Running average for hireScore
    const prevTotal   = p.totalApplications;
    const avgHireScore = (p.avgHireScore * prevTotal + hireScore) / total;

    // Running average for response time (only if provided)
    let avgResponseDays = p.avgResponseDays;
    if (responseTimeDays !== undefined) {
      const prevResponseCount = prevTotal - p.noResponse;
      const newResponseCount  = prevResponseCount + 1;
      avgResponseDays = newResponseCount > 0
        ? ((p.avgResponseDays ?? 0) * prevResponseCount + responseTimeDays) / newResponseCount
        : responseTimeDays;
    }

    return {
      ...p,
      totalApplications: total,
      interviews,
      rejections,
      noResponse,
      offers,
      interviewRate: interviews / total,
      avgHireScore,
      avgResponseDays,
      lastUpdated: new Date().toISOString(),
    };
  }

  private upsertPattern(p: LearningPattern): void {
    // Use the store's DB directly via a workaround: call getLearningPattern first to know if it exists,
    // then use saveOutcome as a template. We need raw SQL access here.
    // Since ProfessionalTwinsStore doesn't expose a generic upsert, we use a cast.
    // This is intentional — LearningEngine is tightly coupled to ProfessionalTwinsStore.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (this.store as any).db;
    if (!db) return;

    db.run(`
      INSERT INTO learning_patterns (
        id, pattern_type, pattern_key,
        total_applications, interviews, rejections, no_response, offers,
        interview_rate, avg_hire_score, avg_response_days, last_updated
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(pattern_type, pattern_key) DO UPDATE SET
        total_applications = excluded.total_applications,
        interviews         = excluded.interviews,
        rejections         = excluded.rejections,
        no_response        = excluded.no_response,
        offers             = excluded.offers,
        interview_rate     = excluded.interview_rate,
        avg_hire_score     = excluded.avg_hire_score,
        avg_response_days  = COALESCE(excluded.avg_response_days, avg_response_days),
        last_updated       = excluded.last_updated
    `, [
      p.id, p.patternType, p.patternKey,
      p.totalApplications, p.interviews, p.rejections, p.noResponse, p.offers,
      p.interviewRate, p.avgHireScore, p.avgResponseDays ?? null,
      p.lastUpdated,
    ]);

    // Flush to disk
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.store as any).persist?.();
  }

  // ── Role classification ───────────────────────────────────────────────────

  private classifyRole(title: string): string | null {
    const t = title.toLowerCase();
    if (t.includes('ai engineer') || t.includes('llm') || t.includes('machine learning')) return 'AI/ML Engineer';
    if (t.includes('backend') || t.includes('back-end') || t.includes('back end')) return 'Backend Engineer';
    if (t.includes('full stack') || t.includes('fullstack')) return 'Full Stack Engineer';
    if (t.includes('architect')) return 'Solutions Architect';
    if (t.includes('tech lead') || t.includes('technical lead') || t.includes('engineering lead')) return 'Tech Lead';
    if (t.includes('principal') || t.includes('staff engineer')) return 'Principal/Staff Engineer';
    if (t.includes('software engineer') || t.includes('software developer')) return 'Software Engineer';
    return null;
  }

  // ── Insights summary ──────────────────────────────────────────────────────

  getInsightsSummary(): {
    topStacks: LearningPattern[];
    topTwins: LearningPattern[];
    topRoles: LearningPattern[];
    overallInterviewRate: number;
  } {
    const topStacks = this.store.getTopPatterns('stack', 10);
    const topTwins  = this.store.getTopPatterns('twin', 4);
    const topRoles  = this.store.getTopPatterns('role', 8);

    const allTwins = this.store.getTopPatterns('twin', 4);
    const totalApps = allTwins.reduce((s, p) => s + p.totalApplications, 0);
    const totalInterviews = allTwins.reduce((s, p) => s + p.interviews, 0);
    const overallInterviewRate = totalApps > 0 ? totalInterviews / totalApps : 0;

    return { topStacks, topTwins, topRoles, overallInterviewRate };
  }
}
