// packages/work/src/agents/ATSOptimizerAgent.ts
// Pre-apply CV optimizer: reorders and emphasizes existing content to maximize
// ATS keyword coverage for a specific job description.
//
// INVARIANT: This agent NEVER invents experience, skills, or qualifications.
// It only reorganizes, rephrases, and emphasizes content already present in the CV.

import Anthropic from '@anthropic-ai/sdk';
import type { Job } from '../types/index.js';
import type { ProfessionalTwin } from '../types/hire-intelligence.js';

export interface ATSOptimizationResult {
  jobId: string;
  twinId: string;

  // Keyword analysis
  keywordsInJD: string[];
  keywordsFoundInCV: string[];
  keywordsMissingFromCV: string[];
  keywordsAdded: string[];          // keywords added via rephrase/emphasis (were there, now visible)
  atsScoreBefore: number;           // 0–100: % of JD keywords in original CV
  atsScoreAfter: number;            // 0–100: % of JD keywords in optimized CV

  // Optimized CV
  optimizedResumeMd: string;

  // Change summary
  changesApplied: string[];
  optimizationNote: string;
}

export class ATSOptimizerAgent {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey });
  }

  async optimize(
    job: Job,
    twin: ProfessionalTwin,
    baseCvMd?: string,
  ): Promise<ATSOptimizationResult> {
    const cv = baseCvMd ?? twin.resumeMd ?? this.generateBaseCvFromTwin(twin);
    const jdKeywords = this.extractKeywords(job.description, twin.atsKeywords);
    const foundBefore = jdKeywords.filter(k => cv.toLowerCase().includes(k.toLowerCase()));
    const missing     = jdKeywords.filter(k => !cv.toLowerCase().includes(k.toLowerCase()));
    const atsScoreBefore = jdKeywords.length > 0
      ? Math.round((foundBefore.length / jdKeywords.length) * 100)
      : 50;

    // If CV is already well-optimized (≥ 85% coverage), skip LLM call
    if (atsScoreBefore >= 85 || missing.length === 0) {
      return {
        jobId:                job.id,
        twinId:               twin.id,
        keywordsInJD:         jdKeywords,
        keywordsFoundInCV:    foundBefore,
        keywordsMissingFromCV: missing,
        keywordsAdded:        [],
        atsScoreBefore,
        atsScoreAfter:        atsScoreBefore,
        optimizedResumeMd:    cv,
        changesApplied:       ['No changes needed — ATS coverage already above threshold.'],
        optimizationNote:     `CV already covers ${atsScoreBefore}% of JD keywords. No optimization needed.`,
      };
    }

    const optimized = await this.callLLM(job, twin, cv, missing, jdKeywords);
    const foundAfter = jdKeywords.filter(k => optimized.optimizedResumeMd.toLowerCase().includes(k.toLowerCase()));
    const atsScoreAfter = jdKeywords.length > 0
      ? Math.round((foundAfter.length / jdKeywords.length) * 100)
      : atsScoreBefore;
    const keywordsAdded = foundAfter.filter(k => !foundBefore.some(f => f.toLowerCase() === k.toLowerCase()));

    return {
      jobId:                job.id,
      twinId:               twin.id,
      keywordsInJD:         jdKeywords,
      keywordsFoundInCV:    foundBefore,
      keywordsMissingFromCV: missing,
      keywordsAdded,
      atsScoreBefore,
      atsScoreAfter,
      optimizedResumeMd:    optimized.optimizedResumeMd,
      changesApplied:       optimized.changesApplied,
      optimizationNote:     optimized.note,
    };
  }

  private async callLLM(
    job: Job,
    twin: ProfessionalTwin,
    cv: string,
    missingKeywords: string[],
    jdKeywords: string[],
  ): Promise<{ optimizedResumeMd: string; changesApplied: string[]; note: string }> {
    const prompt = `You are an ATS optimization specialist. Your task is to improve a candidate's resume to maximize ATS keyword coverage for a specific job, WITHOUT inventing any experience, skills, certifications, or qualifications.

ALLOWED actions:
- Reorder sections or bullet points to bring relevant experience to the top
- Add synonyms or industry-standard terms for skills the candidate already has
- Expand abbreviations (e.g., "TS" → "TypeScript") if the full term appears in the JD
- Rephrase existing bullet points to use job-specific language
- Add the missing keywords ONLY IF there is existing content that supports them

FORBIDDEN actions (do not do any of these):
- Invent technologies the candidate has never used
- Add certifications not in the original CV
- Claim years of experience the candidate doesn't have
- Create fake job titles or companies
- Add quantified metrics not in the original CV

CANDIDATE TWIN: ${twin.label}
MISSING JD KEYWORDS: ${missingKeywords.slice(0, 12).join(', ')}
ALL JD KEYWORDS: ${jdKeywords.slice(0, 20).join(', ')}

JOB TITLE: ${job.title}
JOB DESCRIPTION (excerpt): ${job.description.slice(0, 1200)}

ORIGINAL CV:
${cv.slice(0, 3000)}

Return ONLY this JSON (no extra text):
{
  "optimized_resume_md": "<full optimized CV in markdown>",
  "changes_applied": ["<change 1>", "<change 2>", "<change 3>"],
  "optimization_note": "<1 sentence summary of what was changed and why>"
}`;

    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
      const raw = text.replace(/```json|```/g, '').trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : '{}');

      return {
        optimizedResumeMd: (parsed.optimized_resume_md as string) ?? cv,
        changesApplied:    Array.isArray(parsed.changes_applied) ? parsed.changes_applied : [],
        note:              (parsed.optimization_note as string) ?? 'ATS optimization applied.',
      };
    } catch {
      return {
        optimizedResumeMd: cv,
        changesApplied:    ['LLM optimization failed — returned original CV unchanged.'],
        note:              'Optimization skipped due to LLM error.',
      };
    }
  }

  // ── Keyword extraction ────────────────────────────────────────────────────

  private extractKeywords(jd: string, twinKeywords: string[]): string[] {
    const found = new Set<string>();

    // First pass: check which twin ATS keywords appear in the JD
    for (const kw of twinKeywords) {
      if (jd.toLowerCase().includes(kw.toLowerCase())) {
        found.add(kw);
      }
    }

    // Second pass: extract common tech terms from JD that may not be in twin's list
    const techTerms = this.extractTechTermsFromJD(jd);
    for (const term of techTerms) {
      found.add(term);
    }

    return Array.from(found);
  }

  private extractTechTermsFromJD(jd: string): string[] {
    const commonTech = [
      'Python', 'TypeScript', 'JavaScript', 'Node.js', 'React', 'Vue', 'Angular',
      'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Docker', 'Kubernetes', 'AWS', 'Azure', 'GCP',
      'REST', 'GraphQL', 'gRPC', 'Kafka', 'RabbitMQ', 'Elasticsearch',
      'LLM', 'RAG', 'GPT', 'Claude', 'OpenAI', 'Anthropic', 'embeddings', 'pgvector',
      'multi-agent', 'AI', 'ML', 'NLP', 'transformer', 'fine-tuning',
      'microservices', 'serverless', 'CI/CD', 'DevOps', 'Terraform',
      'FastAPI', 'Django', 'Express', 'Fastify', 'Spring',
      'Agile', 'Scrum', 'TDD', 'DDD',
    ];

    return commonTech.filter(t => jd.toLowerCase().includes(t.toLowerCase()));
  }

  // ── Base CV generator from twin data (when no resumeMd available) ─────────

  private generateBaseCvFromTwin(twin: ProfessionalTwin): string {
    return `# Samir Ricardo Almeida
${twin.headline}

## About
${twin.about}

## Skills
${twin.skills.join(' · ')}

## Primary Stack
${twin.primaryStack.join(', ')}

## Target Roles
${twin.targetRoles.join(', ')}
`;
  }
}
