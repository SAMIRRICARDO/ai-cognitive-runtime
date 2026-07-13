// packages/work/src/__tests__/ErrorClassifier.test.ts
import { describe, it, expect } from 'vitest';
import { ErrorClassifier } from '../application/ErrorClassifier.js';

const classifier = new ErrorClassifier();

describe('ErrorClassifier', () => {
  it('classifies timeout errors', () => {
    const err = classifier.classify('navigation timeout after 30000ms', 'opening_job');
    expect(err.category).toBe('TIMEOUT_ERROR');
    expect(err.retryable).toBe(true);
    expect(err.rca).toBeTruthy();
    expect(err.recommendation).toBeTruthy();
  });

  it('classifies CAPTCHA errors', () => {
    const err = classifier.classify('captcha challenge detected by platform', 'starting');
    expect(err.category).toBe('CAPTCHA_ERROR');
    expect(err.retryable).toBe(false);
  });

  it('classifies login/session errors', () => {
    const err = classifier.classify('401 unauthorized — session expired', 'opening_job');
    expect(err.category).toBe('LOGIN_ERROR');
    expect(err.retryable).toBe(false);
  });

  it('classifies DOM errors', () => {
    const err = classifier.classify('locator.resolve: strict mode violation — element not visible in DOM', 'filling_questions');
    expect(err.category).toBe('DOM_ERROR');
    expect(err.retryable).toBe(true);
  });

  it('classifies rate limit errors', () => {
    const err = classifier.classify('429 Too Many Requests — rate limit exceeded', 'starting');
    expect(err.category).toBe('RATE_LIMIT_ERROR');
    expect(err.retryable).toBe(false);
  });

  it('classifies upload errors', () => {
    const err = classifier.classify('setInputFiles: pdf file not found at resume path', 'uploading_resume');
    expect(err.category).toBe('UPLOAD_ERROR');
    expect(err.retryable).toBe(true);
  });

  it('classifies ATS errors', () => {
    const err = classifier.classify('greenhouse application failed — form validation error', 'submitting');
    expect(err.category).toBe('ATS_ERROR');
    expect(err.retryable).toBe(true);
  });

  it('classifies LLM errors', () => {
    const err = classifier.classify('anthropic api error: model unavailable', 'filling_questions');
    expect(err.category).toBe('LLM_ERROR');
    expect(err.retryable).toBe(false);
  });

  it('classifies database errors', () => {
    const err = classifier.classify('SQLITE_BUSY: database is locked', 'queued');
    expect(err.category).toBe('DATABASE_ERROR');
    expect(err.retryable).toBe(false);
  });

  it('uses state-based RCA for unknown errors', () => {
    const err = classifier.classify('unexpected widget failure XYZ-999', 'filling_questions');
    expect(err.category).toBe('UNKNOWN_ERROR');
    expect(err.rca).toContain('preench'); // from state-based RCA for filling_questions
  });

  it('always has timestamp', () => {
    const err = classifier.classify('some error', 'failed');
    expect(err.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('truncates very long error messages', () => {
    const longMsg = 'error: '.repeat(200);
    const err = classifier.classify(longMsg, 'failed');
    expect(err.message.length).toBeLessThanOrEqual(500);
  });

  it('static summarize aggregates categories', () => {
    const errors = [
      classifier.classify('timeout', 'opening_job'),
      classifier.classify('timeout again', 'opening_job'),
      classifier.classify('captcha detected', 'starting'),
    ];
    const summary = ErrorClassifier.summarize(errors);
    expect(summary['TIMEOUT_ERROR']).toBe(2);
    expect(summary['CAPTCHA_ERROR']).toBe(1);
  });
});
