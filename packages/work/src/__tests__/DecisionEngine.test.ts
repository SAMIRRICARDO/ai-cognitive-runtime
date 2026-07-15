// packages/work/src/engine/__tests__/DecisionEngine.test.ts
import { describe, it, expect } from 'vitest';
import {
  scoreCompany,
  timingScore,
  recruiterScore,
  outcomeAdjustment,
  computeDecisionScore,
  classifyPrediction,
  LEARNING_TRIGGER_STATES,
  toInterviewOutcomeType,
} from '../engine/decision-engine.js';
import type { LearningPattern } from '../types/hire-intelligence.js';

// ── scoreCompany ──────────────────────────────────────────────────────────────

describe('scoreCompany', () => {
  it('identifies Big Tech companies', () => {
    expect(scoreCompany('Google Brasil Ltda').tier).toBe('BIG_TECH');
    expect(scoreCompany('Google Brasil Ltda').score).toBe(95);
    expect(scoreCompany('Microsoft Corporation').tier).toBe('BIG_TECH');
    expect(scoreCompany('Meta Platforms').tier).toBe('BIG_TECH');
  });

  it('identifies Premium Consultancies', () => {
    expect(scoreCompany('Accenture do Brasil').tier).toBe('PREMIUM');
    expect(scoreCompany('ThoughtWorks').tier).toBe('PREMIUM');
    expect(scoreCompany('Deloitte').tier).toBe('PREMIUM');
  });

  it('identifies Brazilian Unicorns', () => {
    expect(scoreCompany('Nubank S.A.').tier).toBe('UNICORN');
    expect(scoreCompany('CI&T Inc').tier).toBe('UNICORN');
    expect(scoreCompany('iFood').tier).toBe('UNICORN');
    expect(scoreCompany('UPBI').tier).toBe('UNICORN');
    expect(scoreCompany('Outly').tier).toBe('UNICORN');
  });

  it('identifies Fortune/Established companies', () => {
    // 's/a', ' inc', ' corp' are matched after normalization (non-alpha replaced by space)
    expect(scoreCompany('Empresa S/A').tier).toBe('FORTUNE');
    expect(scoreCompany('Acme Corp').tier).toBe('FORTUNE');
    expect(scoreCompany('Tech Inc').tier).toBe('FORTUNE');
  });

  it('returns UNKNOWN for unrecognized companies', () => {
    const r = scoreCompany('Startup Desconhecida');
    expect(r.tier).toBe('UNKNOWN');
    expect(r.score).toBe(55);
  });
});

// ── timingScore ───────────────────────────────────────────────────────────────

describe('timingScore', () => {
  it('returns 100 for jobs published less than 1 day ago', () => {
    expect(timingScore(0)).toBe(100);
    expect(timingScore(0.5)).toBe(100);
  });

  it('returns 95 for jobs published exactly 1 day ago', () => {
    expect(timingScore(1)).toBe(95);
  });

  it('decreases progressively with age', () => {
    expect(timingScore(2)).toBe(88);
    expect(timingScore(3)).toBe(80);
    expect(timingScore(5)).toBe(65);
    expect(timingScore(7)).toBe(50);
    expect(timingScore(14)).toBe(30);
    expect(timingScore(30)).toBe(10);
  });

  it('minimum score is 10 for very old jobs', () => {
    expect(timingScore(60)).toBe(10);
    expect(timingScore(365)).toBe(10);
  });
});

// ── recruiterScore ────────────────────────────────────────────────────────────

describe('recruiterScore', () => {
  it('returns 55 with no signals (50 base + 5 direct-apply bonus)', () => {
    // isEasyApply not specified = undefined = falsy → +5 direct apply bonus
    expect(recruiterScore({})).toBe(55);
  });

  it('boosts for referral (highest signal)', () => {
    // 50 + 30(referral) + 5(!isEasyApply) = 85
    const s = recruiterScore({ hasReferral: true });
    expect(s).toBeGreaterThan(50);
    expect(s).toBe(85);
  });

  it('boosts for active recruiter + connected', () => {
    // 50 + 20(activeRecruiter) + 15(connected) + 5(!isEasyApply) = 90
    const s = recruiterScore({ hasActiveRecruiter: true, isConnected: true });
    expect(s).toBe(90);
  });

  it('no bonus for direct easy apply', () => {
    // 50 + 0(!isEasyApply is false) = 50
    const s = recruiterScore({ isEasyApply: true });
    expect(s).toBe(50);
  });

  it('caps at 100', () => {
    const s = recruiterScore({ hasReferral: true, hasActiveRecruiter: true, isConnected: true, messagesOpen: true });
    expect(s).toBe(100);
  });
});

// ── outcomeAdjustment ─────────────────────────────────────────────────────────

describe('outcomeAdjustment', () => {
  it('returns 0 with no patterns', () => {
    expect(outcomeAdjustment([], 'twin_ai_engineer')).toBe(0);
  });

  it('returns 0 if twin has fewer than 3 applications', () => {
    const p: LearningPattern = {
      id: '1', patternType: 'twin', patternKey: 'twin_ai_engineer',
      totalApplications: 2, interviews: 1, rejections: 1, noResponse: 0, offers: 0,
      interviewRate: 0.5, avgHireScore: 80, lastUpdated: '',
    };
    expect(outcomeAdjustment([p], 'twin_ai_engineer')).toBe(0);
  });

  it('returns positive adjustment for high interview rate', () => {
    const p: LearningPattern = {
      id: '1', patternType: 'twin', patternKey: 'twin_ai_engineer',
      totalApplications: 10, interviews: 8, rejections: 2, noResponse: 0, offers: 2,
      interviewRate: 0.8, avgHireScore: 85, lastUpdated: '',
    };
    const adj = outcomeAdjustment([p], 'twin_ai_engineer');
    expect(adj).toBeGreaterThan(0);
  });

  it('returns negative adjustment for low interview rate', () => {
    const p: LearningPattern = {
      id: '1', patternType: 'twin', patternKey: 'twin_ai_engineer',
      totalApplications: 10, interviews: 0, rejections: 10, noResponse: 0, offers: 0,
      interviewRate: 0, avgHireScore: 60, lastUpdated: '',
    };
    const adj = outcomeAdjustment([p], 'twin_ai_engineer');
    expect(adj).toBeLessThan(0);
  });
});

// ── computeDecisionScore ──────────────────────────────────────────────────────

describe('computeDecisionScore', () => {
  const mockHire = (ip: number, age = 1) => ({
    interviewProbability: ip,
    marketContext: { competitionLevel: 'medium' as const, publicationAgeDays: age, platformEaseScore: 70 },
  });

  // Composite score = IP×0.50 + Company×0.15 + Timing×0.10 + Recruiter×0.10 + Outcome×0.15
  // With no recruiter signals (baseline=50) and no outcome learning:
  //   IP=95, BIG_TECH(95), timing=100: 47.5+14.25+10+5+7.5 = 84 → MEDIUM
  // IMMEDIATE requires full recruiter signals + good outcome history.

  it('scores IP=95 at Big Tech as MEDIUM without recruiter signals', () => {
    const ds = computeDecisionScore(mockHire(95, 0), 'Google Brasil');
    expect(ds.score).toBeGreaterThanOrEqual(80);
    expect(ds.companyTier).toBe('BIG_TECH');
    expect(['MEDIUM', 'HIGH']).toContain(ds.priority);
  });

  it('reaches IMMEDIATE with all signals: referral + active recruiter + strong outcome history', () => {
    const highInterviewPattern: LearningPattern = {
      id: '1', patternType: 'twin', patternKey: 'twin_ai_engineer',
      totalApplications: 20, interviews: 20, rejections: 0, noResponse: 0, offers: 5,
      interviewRate: 1.0, avgHireScore: 95, lastUpdated: '',
    };
    const ds = computeDecisionScore(
      { interviewProbability: 98, marketContext: { competitionLevel: 'low', publicationAgeDays: 0, platformEaseScore: 90 } },
      'Google',
      [highInterviewPattern],
      'twin_ai_engineer',
      { hasReferral: true, hasActiveRecruiter: true, isConnected: true, messagesOpen: true },
    );
    expect(ds.score).toBeGreaterThanOrEqual(95);
    expect(ds.priority).toBe('IMMEDIATE');
  });

  it('reaches HIGH with full recruiter signals at BIG_TECH (no outcome history)', () => {
    const ds = computeDecisionScore(
      { interviewProbability: 98, marketContext: { competitionLevel: 'low', publicationAgeDays: 0, platformEaseScore: 90 } },
      'Google',
      [],
      'twin_ai_engineer',
      { hasReferral: true, hasActiveRecruiter: true, isConnected: true, messagesOpen: true },
    );
    expect(ds.score).toBeGreaterThanOrEqual(88);
    expect(['HIGH', 'IMMEDIATE']).toContain(ds.priority);
  });

  it('IP=90 at Nubank (1 day) scores as MEDIUM without extra signals', () => {
    const ds = computeDecisionScore(mockHire(90, 1), 'Nubank');
    expect(ds.score).toBeGreaterThanOrEqual(78);
    expect(['MEDIUM', 'HIGH']).toContain(ds.priority);
  });

  it('returns SKIP for IP=40 at unknown company (old job)', () => {
    const ds = computeDecisionScore(mockHire(40, 30), 'Empresa XYZ');
    expect(ds.priority).toBe('SKIP');
    expect(ds.score).toBeLessThan(70);
  });

  it('score is always 0-100', () => {
    for (const ip of [0, 25, 50, 75, 95, 100]) {
      const ds = computeDecisionScore(mockHire(ip, 3), 'Google');
      expect(ds.score).toBeGreaterThanOrEqual(0);
      expect(ds.score).toBeLessThanOrEqual(100);
    }
  });

  it('includes reasoning and breakdown', () => {
    const ds = computeDecisionScore(mockHire(80, 2), 'CI&T');
    expect(ds.reasoning).toContain('CDS');
    expect(ds.breakdown.interviewProbability).toBe(80);
    expect(ds.breakdown.companyScore).toBeGreaterThan(0);
  });

  it('IMMEDIATE actions include Cover Letter and recruiter search', () => {
    const ds = computeDecisionScore(
      mockHire(98, 0), 'Google', [], '',
      { hasReferral: true, hasActiveRecruiter: true, isConnected: true, messagesOpen: true },
    );
    expect(ds.actions.some(a => a.includes('Cover Letter'))).toBe(true);
    expect(ds.actions.length).toBeGreaterThan(2);
  });

  it('SKIP actions contain exactly one entry', () => {
    const skip = computeDecisionScore(mockHire(20, 30), 'Empresa Z');
    expect(skip.actions.length).toBe(1);
    expect(skip.actions[0]).toContain('Skip');
  });
});

// ── classifyPrediction ────────────────────────────────────────────────────────

describe('classifyPrediction', () => {
  it('TRUE_POSITIVE: predicted AND got interview', () => {
    expect(classifyPrediction(80, true)).toBe('TRUE_POSITIVE');
  });

  it('FALSE_POSITIVE: predicted but no interview', () => {
    expect(classifyPrediction(80, false)).toBe('FALSE_POSITIVE');
  });

  it('FALSE_NEGATIVE: did not predict but got interview', () => {
    expect(classifyPrediction(60, true)).toBe('FALSE_NEGATIVE');
  });

  it('TRUE_NEGATIVE: did not predict and no interview', () => {
    expect(classifyPrediction(60, false)).toBe('TRUE_NEGATIVE');
  });

  it('uses custom threshold', () => {
    expect(classifyPrediction(70, true, 60)).toBe('TRUE_POSITIVE');
    expect(classifyPrediction(70, true, 80)).toBe('FALSE_NEGATIVE');
  });
});

// ── D.I.A. state machine helpers ──────────────────────────────────────────────

describe('LEARNING_TRIGGER_STATES', () => {
  it('includes terminal states that affect model training', () => {
    expect(LEARNING_TRIGGER_STATES).toContain('rh_interview');
    expect(LEARNING_TRIGGER_STATES).toContain('offer');
    expect(LEARNING_TRIGGER_STATES).toContain('hired');
    expect(LEARNING_TRIGGER_STATES).toContain('rejected');
    expect(LEARNING_TRIGGER_STATES).toContain('ghost');
  });

  it('does not include transient states', () => {
    expect(LEARNING_TRIGGER_STATES).not.toContain('applied');
    expect(LEARNING_TRIGGER_STATES).not.toContain('viewed');
    expect(LEARNING_TRIGGER_STATES).not.toContain('questionnaire');
  });
});

describe('toInterviewOutcomeType', () => {
  it('maps interview states correctly', () => {
    expect(toInterviewOutcomeType('rh_interview')).toBe('interview');
    expect(toInterviewOutcomeType('technical_interview')).toBe('interview');
    expect(toInterviewOutcomeType('manager_interview')).toBe('interview');
  });

  it('maps terminal states correctly', () => {
    expect(toInterviewOutcomeType('offer')).toBe('offer');
    expect(toInterviewOutcomeType('hired')).toBe('hired');
    expect(toInterviewOutcomeType('rejected')).toBe('rejection');
    expect(toInterviewOutcomeType('ghost')).toBe('ghosted');
  });

  it('maps transitional states to no_response', () => {
    expect(toInterviewOutcomeType('applied')).toBe('no_response');
    expect(toInterviewOutcomeType('viewed')).toBe('no_response');
  });
});
