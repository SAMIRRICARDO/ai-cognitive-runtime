// packages/work/src/rag/candidate-profile-loader.ts
// Single Source of Truth (SSoT) — reads candidate-profile.json, validates on load,
// normalizes skill names, tracks per-layer metrics, and drives the binary answer engine.

import fs from 'fs';
import path from 'path';
import { CandidateProfileValidator } from './candidate-profile-validator.js';
import { SkillNormalizer } from './skill-normalizer.js';
import { ProfileMetrics } from './profile-metrics.js';

// Re-export all types from the central types file for backward compatibility
export type {
  CandidateFact,
  SkillEntry,
  EvidenceProject,
  EvidenceSourceLink,
  FactEvidence,
  CandidateProfile,
  ProfileMetadata,
  DecisionTrace,
  LayerMetrics,
  MetricsSnapshot,
  IBinaryAnswerer,
  IEvidenceEngine,
  ISkillGraph,
  IConfidenceEngine,
  IIntentClassifier,
} from './candidate-profile-types.js';

export { DecisionLayer, QuestionIntent, FactCategory } from './candidate-profile-types.js';

import type {
  CandidateFact,
  SkillEntry,
  FactEvidence,
  CandidateProfile,
  DecisionTrace,
  MetricsSnapshot,
} from './candidate-profile-types.js';
import { DecisionLayer, QuestionIntent } from './candidate-profile-types.js';

// ── Loader ─────────────────────────────────────────────────────────────────────

export class CandidateProfileLoader {
  private profile: CandidateProfile;
  private triggerIndex: Map<string, string> = new Map(); // normalized trigger → factKey
  private normalizer: SkillNormalizer;
  private metrics: ProfileMetrics;

  constructor(private kbPath: string) {
    this.profile = this.loadProfile();
    this.normalizer = new SkillNormalizer(this.profile.normalizationAliases ?? {});
    this.metrics = new ProfileMetrics();
    this.buildTriggerIndex();

    const validator = new CandidateProfileValidator();
    const result = validator.validate(this.profile);
    for (const err of result.errors) console.error(`[ProfileLoader] VALIDATION ERROR: ${err}`);
    for (const w of result.warnings)  console.warn(`[ProfileLoader] WARNING: ${w}`);

    console.log(
      `[ProfileLoader] v${this.profile.profileVersion} — ` +
      `${Object.keys(this.profile.candidateFacts).length} facts | ` +
      `${Object.keys(this.profile.skills).length} skills carregados`,
    );
  }

  static tryLoad(kbPath: string): CandidateProfileLoader | null {
    try {
      return new CandidateProfileLoader(kbPath);
    } catch (err) {
      console.warn('[ProfileLoader] candidate-profile.json não encontrado — SSoT desativado:', String(err).slice(0, 80));
      return null;
    }
  }

  // ── Profile versioning ────────────────────────────────────────────────────────

  getVersion(): number { return this.profile.profileVersion; }

  // ── Binary question engine ────────────────────────────────────────────────────

  /**
   * Returns true for yes/no capability questions.
   * Excludes numeric questions ("quantos anos") to avoid false positives.
   */
  isBinaryQuestion(text: string): boolean {
    const t = this.normalizeText(text);
    if (/quantos anos|how many (years|months)|how long|ha quanto tempo|por quantos anos/.test(t)) return false;
    return (
      /^(possui |tem |ja |do you have |have you |are you |did you |voce possui |voce tem |voce ja )/.test(t) ||
      /\b(possui|tem\b|have you (worked|used|built|deployed|implemented|created)|do you have|are you (familiar|experienced|proficient))\b/.test(t)
    );
  }

  /** Backward-compatible answer — returns "Sim" | "Não" | null. */
  answerBinaryQuestion(questionText: string, options: string[] = []): string | null {
    return this.answerBinaryQuestionWithTrace(questionText, options)?.answer ?? null;
  }

  /** Full answer with explainability trace. */
  answerBinaryQuestionWithTrace(
    questionText: string,
    options: string[] = [],
  ): { answer: string; trace: DecisionTrace } | null {
    const start = Date.now();
    if (!this.isBinaryQuestion(questionText)) return null;

    const { fact, factKey, trigger } = this.findMatchingFactWithMeta(questionText);
    if (!fact) {
      this.metrics.record(DecisionLayer.CANDIDATE_FACT, false, Date.now() - start);
      return null;
    }

    const yesNo = fact.value ? 'Sim' : 'Não';
    let answer = yesNo;

    if (options.length > 0) {
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
      const pick = (re: RegExp) => options.find(o => re.test(norm(o))) ?? null;
      answer = fact.value
        ? (pick(/^sim$|^yes$|^s$/) ?? pick(/sim|yes/) ?? yesNo)
        : (pick(/^n[aã]o$|^no$|^n$/) ?? pick(/n[aã]o|no\b/) ?? yesNo);
    }

    const latencyMs = Date.now() - start;
    this.metrics.record(DecisionLayer.CANDIDATE_FACT, true, latencyMs);

    return {
      answer,
      trace: {
        layer: DecisionLayer.CANDIDATE_FACT,
        intent: this.classifyIntent(questionText),
        factKey,
        trigger,
        confidence: fact.confidence,
        latencyMs,
      },
    };
  }

  // ── Intent Classifier ─────────────────────────────────────────────────────────

  classifyIntent(text: string): QuestionIntent {
    const t = this.normalizeText(text);

    if (/cpf|email|telefone|nome|linkedin|endereco/.test(t))              return QuestionIntent.IDENTITY;
    if (/pcd|parentesco|sponsor|raca|genero|orientacao sexual/.test(t))   return QuestionIntent.COMPLIANCE;
    if (/quando.*comecar|inicio|aviso previo|notice period/.test(t))      return QuestionIntent.AVAILABILITY;
    if (/quantos anos|anos de experiencia|how many years|how long/.test(t)) return QuestionIntent.QUANTITATIVE;
    if (/pretensao|salario|remuneracao/.test(t))                          return QuestionIntent.PREFERENCE;
    if (/prefere|prefer|gosta de|trabalhar (remoto|presencial)/.test(t))  return QuestionIntent.PREFERENCE;
    if (/^(possui |tem |ja |do you have |have you |are you )/.test(t))    return QuestionIntent.CAPABILITY;
    if (/experiencia|ja (trabalhou|usou|construiu)|already (worked|used)/.test(t)) return QuestionIntent.EXPERIENCE;

    return QuestionIntent.UNKNOWN;
  }

  // ── Evidence engine ───────────────────────────────────────────────────────────

  /**
   * Builds structured evidence context to inject into LLM prompts.
   * The LLM receives already-established facts and generates the explanation only.
   */
  buildEvidenceContext(questionText: string): string {
    const t = this.normalizeText(questionText);
    const lines: string[] = [];

    for (const [factKey, fact] of Object.entries(this.profile.candidateFacts)) {
      const matched = fact.triggers.some(trigger => t.includes(this.normalizeText(trigger)));
      if (!matched) continue;

      const evidence = this.profile.evidence[factKey];
      if (!evidence) {
        lines.push(`FATO: ${fact.value ? 'Sim' : 'Não'} (confiança ${fact.confidence}%)`);
        break;
      }

      lines.push(`FATO VERIFICADO: ${fact.value ? 'SIM' : 'NÃO'} (confiança ${fact.confidence}%)`);
      lines.push(`EVIDÊNCIA: ${evidence.summary}`);

      if (evidence.projects?.length) {
        lines.push('PROJETOS EM PRODUÇÃO:');
        for (const p of evidence.projects.slice(0, 2)) {
          lines.push(`  • ${p.name}: ${p.description}`);
        }
      }
      if (evidence.models?.length)     lines.push(`MODELOS/FERRAMENTAS: ${evidence.models.join(', ')}`);
      if (evidence.techniques?.length) lines.push(`TÉCNICAS: ${evidence.techniques.slice(0, 4).join(', ')}`);
      if (evidence.companies?.length)  lines.push(`EMPRESAS/CONTEXTO: ${evidence.companies.join(' · ')}`);
      if (evidence.context)            lines.push(`CONTEXTO: ${evidence.context}`);

      break; // one evidence block per question is enough
    }

    return lines.join('\n');
  }

  // ── Skills graph / Confidence engine ─────────────────────────────────────────

  getSkill(name: string): SkillEntry | undefined {
    const canonical = this.normalizer.normalize(name);
    return this.profile.skills[canonical]
      ?? this.profile.skills[name.toLowerCase()]
      ?? this.profile.skills[this.normalizeText(name).replace(/\s+/g, '_')];
  }

  getParentSkill(name: string): string | undefined {
    return this.getSkill(name)?.parentSkill;
  }

  getConfidence(nameOrFactKey: string): number {
    const fact = this.profile.candidateFacts[nameOrFactKey];
    if (fact) return fact.confidence;
    return this.getSkill(nameOrFactKey)?.confidence ?? 50;
  }

  getProficiencyLevel(name: string): string {
    return this.getSkill(name)?.level ?? 'Unknown';
  }

  getAllFacts(): Record<string, CandidateFact> {
    return { ...this.profile.candidateFacts };
  }

  getMetrics(): MetricsSnapshot {
    return this.metrics.snapshot();
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  private loadProfile(): CandidateProfile {
    const profilePath = path.join(this.kbPath, 'candidate-profile.json');
    if (!fs.existsSync(profilePath)) {
      throw new Error(`candidate-profile.json não encontrado em: ${profilePath}`);
    }
    const raw = JSON.parse(fs.readFileSync(profilePath, 'utf-8')) as CandidateProfile;
    return this.migrate(raw);
  }

  // Auto-migration: fill in fields introduced in schemaVersion 1.0.0
  private migrate(profile: CandidateProfile): CandidateProfile {
    if (!profile.schemaVersion) {
      profile.schemaVersion = '1.0.0';
      profile.profileId = profile.candidateId ?? 'unknown';
      profile.ownerId   = profile.candidateId ?? 'unknown';
    }
    return profile;
  }

  private buildTriggerIndex(): void {
    for (const [factKey, fact] of Object.entries(this.profile.candidateFacts)) {
      for (const trigger of fact.triggers) {
        this.triggerIndex.set(this.normalizeText(trigger), factKey);
      }
    }
  }

  private findMatchingFactWithMeta(
    text: string,
  ): { fact: CandidateFact | null; factKey: string; trigger: string } {
    const t = this.normalizeText(text);
    for (const [trigger, factKey] of this.triggerIndex) {
      if (t.includes(trigger)) {
        return { fact: this.profile.candidateFacts[factKey] ?? null, factKey, trigger };
      }
    }
    return { fact: null, factKey: '', trigger: '' };
  }

  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
