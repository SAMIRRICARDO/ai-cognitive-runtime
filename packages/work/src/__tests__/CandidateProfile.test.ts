// packages/work/src/__tests__/CandidateProfile.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1.0.0',
    profileId: 'test-001',
    ownerId: 'test-user',
    profileVersion: 5,
    candidateId: 'test-user',
    updatedAt: '2026-07-14',
    normalizationAliases: {
      'python3': 'python',
      'py': 'python',
      'chatgpt': 'openai',
      'gpt-4': 'openai',
      'nodejs': 'node_js',
      'node.js': 'node_js',
    },
    candidateFacts: {
      productionRAG: { value: true,  triggers: ['rag', 'retrieval augmented'], confidence: 100, category: 'technical' },
      productionLLM: { value: true,  triggers: ['llm', 'large language model'], confidence: 100, category: 'technical' },
      kubernetes:    { value: false, triggers: ['kubernetes', 'k8s'],           confidence: 25,  category: 'tool' },
      activeCNPJ:    { value: true,  triggers: ['cnpj'],                        confidence: 100, category: 'legal' },
      agentsAI:      { value: true,  triggers: ['ai agent', 'agentes de ia'],   confidence: 100, category: 'technical' },
    },
    skills: {
      rag:              { hasExperience: true,  production: true,  years: 2, expertiseLevel: 9, confidence: 100, level: 'Expert', frameworks: ['pgvector'], projects: ['VRAXIA'], parentSkill: 'llm_orchestration' },
      llm_orchestration:{ hasExperience: true,  production: true,  years: 2, expertiseLevel: 9, confidence: 100, level: 'Expert', frameworks: ['Anthropic SDK'], projects: ['VRAXIA'] },
      multi_agent_systems:{ hasExperience: true, production: true, years: 2, expertiseLevel: 9, confidence: 100, level: 'Expert', frameworks: ['ReAct'], projects: ['VRAXIA'] },
      kubernetes:       { hasExperience: false, production: false, years: 0, expertiseLevel: 2, confidence: 25,  level: 'Beginner', frameworks: [], projects: [], parentSkill: 'docker' },
      python:           { hasExperience: true,  production: true,  years: 5, expertiseLevel: 7, confidence: 90,  level: 'Senior', frameworks: ['FastAPI'], projects: ['VRAXIA'] },
      node_js:          { hasExperience: true,  production: true,  years: 8, expertiseLevel: 9, confidence: 100, level: 'Expert', frameworks: ['Express'], projects: ['VRAXIA'], parentSkill: 'typescript' },
    },
    evidence: {
      productionRAG: {
        summary: 'RAG em produção desde 2024',
        techniques: ['pgvector', 'TF-IDF'],
        projects: [{ name: 'VRAXIA OS', description: 'RAG em produção' }],
      },
    },
    ...overrides,
  };
}

// Write a profile to a temp dir and return the path
function writeTempProfile(profile: unknown): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-test-'));
  fs.writeFileSync(path.join(tmpDir, 'candidate-profile.json'), JSON.stringify(profile));
  return tmpDir;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CandidateProfileLoader — binary question detection', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = writeTempProfile(makeProfile()); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('detects binary capability questions', async () => {
    const { CandidateProfileLoader } = await import('../rag/candidate-profile-loader.js');
    const loader = new CandidateProfileLoader(tmpDir);
    expect(loader.isBinaryQuestion('Possui experiência com RAG?')).toBe(true);
    expect(loader.isBinaryQuestion('Have you worked with LLMs?')).toBe(true);
    expect(loader.isBinaryQuestion('Tem conhecimento em Docker?')).toBe(true);
  });

  it('rejects numeric questions as non-binary', async () => {
    const { CandidateProfileLoader } = await import('../rag/candidate-profile-loader.js');
    const loader = new CandidateProfileLoader(tmpDir);
    expect(loader.isBinaryQuestion('Quantos anos de experiência com RAG?')).toBe(false);
    expect(loader.isBinaryQuestion('How many years of LLM experience?')).toBe(false);
  });
});

describe('CandidateProfileLoader — fact matching', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = writeTempProfile(makeProfile()); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('answers "Sim" for positive facts matching trigger', async () => {
    const { CandidateProfileLoader } = await import('../rag/candidate-profile-loader.js');
    const loader = new CandidateProfileLoader(tmpDir);
    expect(loader.answerBinaryQuestion('Possui experiência com RAG?')).toBe('Sim');
    expect(loader.answerBinaryQuestion('Possui experiência com LLM?')).toBe('Sim');
    expect(loader.answerBinaryQuestion('Você tem CNPJ ativo?')).toBe('Sim');
  });

  it('answers "Não" for negative facts', async () => {
    const { CandidateProfileLoader } = await import('../rag/candidate-profile-loader.js');
    const loader = new CandidateProfileLoader(tmpDir);
    expect(loader.answerBinaryQuestion('Possui experiência com Kubernetes?')).toBe('Não');
    expect(loader.answerBinaryQuestion('Tem conhecimento em k8s?')).toBe('Não');
  });

  it('returns null when no fact matches', async () => {
    const { CandidateProfileLoader } = await import('../rag/candidate-profile-loader.js');
    const loader = new CandidateProfileLoader(tmpDir);
    expect(loader.answerBinaryQuestion('Possui experiência com Cobol?')).toBeNull();
  });

  it('picks correct option from options array', async () => {
    const { CandidateProfileLoader } = await import('../rag/candidate-profile-loader.js');
    const loader = new CandidateProfileLoader(tmpDir);
    const result = loader.answerBinaryQuestion('Possui experiência com RAG?', ['Não', 'Sim']);
    expect(result).toBe('Sim');
  });
});

describe('CandidateProfileLoader — answerBinaryQuestionWithTrace', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = writeTempProfile(makeProfile()); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns DecisionTrace with CANDIDATE_FACT layer', async () => {
    const { CandidateProfileLoader, DecisionLayer } = await import('../rag/candidate-profile-loader.js');
    const loader = new CandidateProfileLoader(tmpDir);
    const result = loader.answerBinaryQuestionWithTrace('Possui experiência com RAG?');
    expect(result).not.toBeNull();
    expect(result!.trace.layer).toBe(DecisionLayer.CANDIDATE_FACT);
    expect(result!.trace.confidence).toBe(100);
    expect(result!.trace.factKey).toBe('productionRAG');
    expect(typeof result!.trace.latencyMs).toBe('number');
  });

  it('returns null (not an object) for non-binary questions', async () => {
    const { CandidateProfileLoader } = await import('../rag/candidate-profile-loader.js');
    const loader = new CandidateProfileLoader(tmpDir);
    expect(loader.answerBinaryQuestionWithTrace('Quantos anos com RAG?')).toBeNull();
  });
});

describe('CandidateProfileLoader — classifyIntent', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = writeTempProfile(makeProfile()); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('classifies identity questions', async () => {
    const { CandidateProfileLoader, QuestionIntent } = await import('../rag/candidate-profile-loader.js');
    const loader = new CandidateProfileLoader(tmpDir);
    expect(loader.classifyIntent('Qual é seu email?')).toBe(QuestionIntent.IDENTITY);
    expect(loader.classifyIntent('Informe seu CPF')).toBe(QuestionIntent.IDENTITY);
  });

  it('classifies capability questions', async () => {
    const { CandidateProfileLoader, QuestionIntent } = await import('../rag/candidate-profile-loader.js');
    const loader = new CandidateProfileLoader(tmpDir);
    expect(loader.classifyIntent('Possui experiência com RAG?')).toBe(QuestionIntent.CAPABILITY);
  });

  it('classifies compliance questions', async () => {
    const { CandidateProfileLoader, QuestionIntent } = await import('../rag/candidate-profile-loader.js');
    const loader = new CandidateProfileLoader(tmpDir);
    expect(loader.classifyIntent('Você é PCD?')).toBe(QuestionIntent.COMPLIANCE);
  });

  it('classifies quantitative questions', async () => {
    const { CandidateProfileLoader, QuestionIntent } = await import('../rag/candidate-profile-loader.js');
    const loader = new CandidateProfileLoader(tmpDir);
    expect(loader.classifyIntent('Quantos anos de experiência com RAG?')).toBe(QuestionIntent.QUANTITATIVE);
  });
});

describe('CandidateProfileLoader — skill graph', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = writeTempProfile(makeProfile()); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('looks up skill by key', async () => {
    const { CandidateProfileLoader } = await import('../rag/candidate-profile-loader.js');
    const loader = new CandidateProfileLoader(tmpDir);
    const skill = loader.getSkill('rag');
    expect(skill).toBeDefined();
    expect(skill!.level).toBe('Expert');
    expect(skill!.production).toBe(true);
  });

  it('resolves parentSkill from hierarchy', async () => {
    const { CandidateProfileLoader } = await import('../rag/candidate-profile-loader.js');
    const loader = new CandidateProfileLoader(tmpDir);
    expect(loader.getParentSkill('rag')).toBe('llm_orchestration');
    expect(loader.getParentSkill('node_js')).toBe('typescript');
    expect(loader.getParentSkill('kubernetes')).toBe('docker');
  });

  it('returns Expert proficiency for top skills', async () => {
    const { CandidateProfileLoader } = await import('../rag/candidate-profile-loader.js');
    const loader = new CandidateProfileLoader(tmpDir);
    expect(loader.getProficiencyLevel('rag')).toBe('Expert');
    expect(loader.getProficiencyLevel('llm_orchestration')).toBe('Expert');
  });
});

describe('SkillNormalizer — alias resolution', () => {
  it('normalizes python aliases', async () => {
    const { SkillNormalizer } = await import('../rag/skill-normalizer.js');
    const n = new SkillNormalizer({ 'python3': 'python', 'py': 'python', 'chatgpt': 'openai', 'nodejs': 'node_js' });
    expect(n.normalize('python3')).toBe('python');
    expect(n.normalize('Python3')).toBe('python');
    expect(n.normalize('py')).toBe('python');
    expect(n.normalize('chatgpt')).toBe('openai');
    expect(n.normalize('nodejs')).toBe('node_js');
  });

  it('falls back to normalized key when no alias', async () => {
    const { SkillNormalizer } = await import('../rag/skill-normalizer.js');
    const n = new SkillNormalizer({});
    expect(n.normalize('TypeScript')).toBe('typescript');
    expect(n.normalize('Node.js')).toBe('node_js');
  });
});

describe('CandidateProfileValidator — schema validation', () => {
  it('accepts a valid profile', async () => {
    const { CandidateProfileValidator } = await import('../rag/candidate-profile-validator.js');
    const validator = new CandidateProfileValidator();
    const result = validator.validate(makeProfile() as never);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects a profile missing candidateId', async () => {
    const { CandidateProfileValidator } = await import('../rag/candidate-profile-validator.js');
    const validator = new CandidateProfileValidator();
    const bad = makeProfile({ candidateId: '' });
    const result = validator.validate(bad as never);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('candidateId'))).toBe(true);
  });

  it('emits consistency warning when productionRAG=true but rag skill missing', async () => {
    const { CandidateProfileValidator } = await import('../rag/candidate-profile-validator.js');
    const validator = new CandidateProfileValidator();
    const profile = makeProfile();
    delete (profile.skills as Record<string, unknown>)['rag'];
    const result = validator.validate(profile as never);
    expect(result.warnings.some(w => w.includes('productionRAG'))).toBe(true);
  });
});

describe('ProfileMetrics — observability counters', () => {
  it('tracks hits and misses per layer', async () => {
    const { ProfileMetrics } = await import('../rag/profile-metrics.js');
    const { DecisionLayer } = await import('../rag/candidate-profile-types.js');
    const metrics = new ProfileMetrics();
    metrics.record(DecisionLayer.CANDIDATE_FACT, true, 1);
    metrics.record(DecisionLayer.CANDIDATE_FACT, true, 2);
    metrics.record(DecisionLayer.CACHE, false, 3);
    const snap = metrics.snapshot();
    expect(snap.totalQuestions).toBe(3);
    expect(snap.byLayer[DecisionLayer.CANDIDATE_FACT]?.hits).toBe(2);
    expect(snap.byLayer[DecisionLayer.CACHE]?.misses).toBe(1);
    expect(snap.cacheHitRate).toBe(0);
  });

  it('resets all counters', async () => {
    const { ProfileMetrics } = await import('../rag/profile-metrics.js');
    const { DecisionLayer } = await import('../rag/candidate-profile-types.js');
    const metrics = new ProfileMetrics();
    metrics.record(DecisionLayer.LLM, true, 50);
    metrics.reset();
    expect(metrics.snapshot().totalQuestions).toBe(0);
  });
});
