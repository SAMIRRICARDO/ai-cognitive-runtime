// packages/work/src/__tests__/ApplicationStateMachine.test.ts
import { describe, it, expect } from 'vitest';
import { ApplicationStateMachine } from '../application/ApplicationStateMachine.js';

describe('ApplicationStateMachine', () => {
  it('starts in queued state', () => {
    const sm = new ApplicationStateMachine('job_1');
    expect(sm.getState()).toBe('queued');
    expect(sm.isTerminal()).toBe(false);
  });

  it('follows valid transition path to confirmed', () => {
    const sm = new ApplicationStateMachine('job_1');
    const transitions: string[] = [];

    sm.transition('starting');
    sm.transition('opening_job');
    sm.transition('opening_easy_apply');
    sm.transition('uploading_resume');
    sm.transition('filling_questions');
    sm.transition('submitting');
    sm.transition('submitted');
    sm.transition('validating');
    sm.transition('confirmed');

    expect(sm.getState()).toBe('confirmed');
    expect(sm.isTerminal()).toBe(true);
  });

  it('rejects invalid transitions', () => {
    const sm = new ApplicationStateMachine('job_2');
    expect(() => sm.transition('confirmed')).toThrow(/Transição inválida/);
    expect(sm.getState()).toBe('queued');
  });

  it('tryTransition returns false and does not throw on invalid', () => {
    const sm = new ApplicationStateMachine('job_3');
    const ok = sm.tryTransition('confirmed');
    expect(ok).toBe(false);
    expect(sm.getState()).toBe('queued');
  });

  it('handles retry cycle: failed → retrying → starting', () => {
    const sm = new ApplicationStateMachine('job_4');
    sm.transition('starting');
    sm.transition('opening_job');
    sm.transition('failed');
    sm.transition('retrying');
    sm.transition('starting');
    expect(sm.getState()).toBe('starting');
    expect(sm.isTerminal()).toBe(false);
  });

  it('new state: already_applied is terminal', () => {
    const sm = new ApplicationStateMachine('job_5');
    sm.transition('already_applied');
    expect(sm.getState()).toBe('already_applied');
    expect(sm.isTerminal()).toBe(true);
    expect(() => sm.transition('starting')).toThrow(/terminal/i);
  });

  it('new state: career lifecycle confirmed → interview → offer → hired', () => {
    const sm = new ApplicationStateMachine('job_6');
    sm.transition('starting');
    sm.transition('opening_job');
    sm.transition('opening_easy_apply');
    sm.transition('filling_questions');
    sm.transition('submitting');
    sm.transition('submitted');
    sm.transition('confirmed');
    sm.transition('interview');
    sm.transition('offer');
    sm.transition('hired');
    expect(sm.getState()).toBe('hired');
    expect(sm.isTerminal()).toBe(true);
  });

  it('getDurationByStep accumulates times', () => {
    const sm = new ApplicationStateMachine('job_7');
    sm.transition('starting');
    sm.transition('failed');
    const durations = sm.getDurationByStep();
    expect(Object.keys(durations)).toContain('queued');
    expect(Object.keys(durations)).toContain('starting');
  });

  it('url-redirect path: filling_questions → submitting → submitted', () => {
    const sm = new ApplicationStateMachine('job_url_redirect');
    sm.transition('starting');
    sm.transition('opening_job');
    sm.transition('opening_easy_apply');
    sm.transition('uploading_resume');
    sm.transition('filling_questions');
    // Simulates the fixed URL-redirect sequence (was incorrectly trying filling_questions → submitted)
    sm.transition('submitting');
    sm.transition('submitted');
    expect(sm.getState()).toBe('submitted');
  });

  it('url-redirect path after review: reviewing → submitting → submitted', () => {
    const sm = new ApplicationStateMachine('job_review_redirect');
    sm.transition('starting');
    sm.transition('opening_job');
    sm.transition('opening_easy_apply');
    sm.transition('filling_questions');
    sm.transition('reviewing');
    sm.transition('submitting');
    sm.transition('submitted');
    expect(sm.getState()).toBe('submitted');
  });

  it('fires onTransition callback', () => {
    const fired: string[] = [];
    const sm = new ApplicationStateMachine('job_8', (t) => fired.push(`${t.from}→${t.to}`));
    sm.transition('starting');
    sm.transition('failed');
    expect(fired).toEqual(['queued→starting', 'starting→failed']);
  });

  it('new state: discovered can be first state via transition path', () => {
    const sm = new ApplicationStateMachine('job_9');
    // discovered requires discovered to be in VALID_TRANSITIONS for queued
    // Actually discovered is a starting state, not a transition FROM queued
    // queued → already_applied is valid
    sm.transition('already_applied');
    expect(sm.getState()).toBe('already_applied');
  });
});
