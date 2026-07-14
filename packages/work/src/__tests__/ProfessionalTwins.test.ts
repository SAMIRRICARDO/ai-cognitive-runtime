// packages/work/src/__tests__/ProfessionalTwins.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// We test the store using a temp directory so it doesn't touch the real DB.
// We temporarily override process.cwd() behavior by pointing the store to a temp path.

describe('ProfessionalTwinsStore — DB schema and defaults', () => {
  let tmpDir: string;
  let originalCwd: typeof process.cwd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twins-test-'));
    originalCwd = process.cwd;
    process.cwd = () => tmpDir;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('seeds 4 default twins on first init', async () => {
    const { ProfessionalTwinsStore } = await import('../twin/professional-twins.js');
    const store = await ProfessionalTwinsStore.create();
    const twins = store.getAll();
    expect(twins).toHaveLength(4);
    store.close();
  });

  it('each twin has required fields', async () => {
    const { ProfessionalTwinsStore } = await import('../twin/professional-twins.js');
    const store = await ProfessionalTwinsStore.create();
    const twins = store.getAll();

    for (const twin of twins) {
      expect(twin.id).toBeTruthy();
      expect(twin.label).toBeTruthy();
      expect(twin.headline).toBeTruthy();
      expect(twin.primaryStack.length).toBeGreaterThan(0);
      expect(twin.atsKeywords.length).toBeGreaterThan(5);
      expect(twin.targetRoles.length).toBeGreaterThan(0);
      expect(twin.targetSalary).toBeGreaterThan(0);
    }
    store.close();
  });

  it('getById returns the correct twin', async () => {
    const { ProfessionalTwinsStore } = await import('../twin/professional-twins.js');
    const store = await ProfessionalTwinsStore.create();

    const aiTwin = store.getById('twin_ai_engineer');
    expect(aiTwin).not.toBeNull();
    expect(aiTwin?.id).toBe('twin_ai_engineer');
    expect(aiTwin?.targetSeniority).toBe('senior');

    const archTwin = store.getById('twin_architect');
    expect(archTwin?.targetSeniority).toBe('architect');
    expect(archTwin?.targetSalary).toBeGreaterThan(14000);

    store.close();
  });

  it('all 4 expected twin IDs are present', async () => {
    const { ProfessionalTwinsStore } = await import('../twin/professional-twins.js');
    const store = await ProfessionalTwinsStore.create();
    const ids = store.getAll().map(t => t.id);

    expect(ids).toContain('twin_ai_engineer');
    expect(ids).toContain('twin_backend');
    expect(ids).toContain('twin_architect');
    expect(ids).toContain('twin_techlead');

    store.close();
  });

  it('saveHireScore and getCachedHireScore round-trips correctly', async () => {
    const { ProfessionalTwinsStore } = await import('../twin/professional-twins.js');
    const store = await ProfessionalTwinsStore.create();

    const now = new Date();
    const expires = new Date(now.getTime() + 3 * 86_400_000).toISOString();

    const score = {
      jobId: 'job_test_001',
      twinId: 'twin_ai_engineer' as const,
      dimensions: {
        technicalFit: 85, salaryFit: 70, seniorityFit: 90,
        locationFit: 95, atsProbability: 80, historicalScore: 60,
      },
      marketContext: {
        competitionLevel: 'medium' as const,
        publicationAgeDays: 2,
        platformEaseScore: 70,
      },
      interviewProbability: 78,
      hireScore: 83,
      action: 'REVIEW' as const,
      reasoning: 'Strong technical match, medium competition.',
      keyStrengths: ['TypeScript', 'LLM', 'pgvector'],
      keyWeaknesses: ['Kubernetes not in stack'],
      atsKeywordsFound: ['LLM', 'RAG'],
      atsKeywordsMissing: ['Kubernetes'],
      scoredAt: now.toISOString(),
      expiresAt: expires,
    };

    store.saveHireScore(score);
    const retrieved = store.getCachedHireScore('job_test_001');

    expect(retrieved).not.toBeNull();
    expect(retrieved?.hireScore).toBe(83);
    expect(retrieved?.interviewProbability).toBe(78);
    expect(retrieved?.action).toBe('REVIEW');
    expect(retrieved?.twinId).toBe('twin_ai_engineer');
    expect(retrieved?.keyStrengths).toContain('TypeScript');

    store.close();
  });

  it('getCachedHireScore returns null for expired scores', async () => {
    const { ProfessionalTwinsStore } = await import('../twin/professional-twins.js');
    const store = await ProfessionalTwinsStore.create();

    // Save a score that is already expired
    const pastExpiry = new Date(Date.now() - 1000).toISOString();

    const score = {
      jobId: 'job_expired_001',
      twinId: 'twin_backend' as const,
      dimensions: { technicalFit: 50, salaryFit: 50, seniorityFit: 50, locationFit: 50, atsProbability: 50, historicalScore: 50 },
      marketContext: { competitionLevel: 'medium' as const, publicationAgeDays: 3, platformEaseScore: 70 },
      interviewProbability: 50,
      hireScore: 50,
      action: 'SKIP' as const,
      reasoning: 'test',
      keyStrengths: [], keyWeaknesses: [],
      atsKeywordsFound: [], atsKeywordsMissing: [],
      scoredAt: new Date(Date.now() - 5000).toISOString(),
      expiresAt: pastExpiry,
    };

    store.saveHireScore(score);
    const retrieved = store.getCachedHireScore('job_expired_001');
    expect(retrieved).toBeNull();

    store.close();
  });

  it('seeding is idempotent — running init twice does not duplicate twins', async () => {
    const { ProfessionalTwinsStore } = await import('../twin/professional-twins.js');
    const store1 = await ProfessionalTwinsStore.create();
    store1.close();

    const store2 = await ProfessionalTwinsStore.create();
    const twins = store2.getAll();
    expect(twins).toHaveLength(4);  // not 8
    store2.close();
  });
});
