// packages/work/src/cli/hunt.ts
// VRAXIA WORK — Hunt Mode (LinkedIn + Gupy + Catho)
// Uso: tsx src/cli/hunt.ts [--platform linkedin|gupy|catho|all] [--dry-run] [--headless]

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), override: false });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false });

import { program } from 'commander';
import { LinkedInSession } from '../engine/session.js';
import { JobSearchEngine } from '../engine/search.js';
import { GupySearchEngine, GupyApplyEngine, GupyJob } from '../engine/gupy.js';
import { CathoSession, CathoSearchEngine, CathoApplyEngine } from '../engine/catho.js';
import { ObsidianVaultLoader } from '../rag/vault-loader.js';
import { VaultRetriever } from '../rag/retriever.js';
import { CandidateKBLoader } from '../rag/candidate-kb-loader.js';
import { CandidateKBRetriever } from '../rag/candidate-kb-retriever.js';
import { CandidateProfileLoader } from '../rag/candidate-profile-loader.js';
import { MatchAgent } from '../agents/MatchAgent.js';
import { HireScoreAgent } from '../agents/HireScoreAgent.js';
import { TwinSelectorAgent } from '../agents/TwinSelectorAgent.js';
import { QuestionnaireAgent } from '../agents/QuestionnaireAgent.js';
import { QuestionnaireLogger } from '../agents/QuestionnaireLogger.js';
import { TwinStore } from '../twin/candidate-twin.js';
import { ProfessionalTwinsStore } from '../twin/professional-twins.js';
import { CareerMemory } from '../memory/career-memory.js';
import { JobSearchConfig, CathoSearchConfig, CathoJob, Job, ApplicationStatus, JobScore } from '../types/index.js';
import type { HireScore } from '../types/hire-intelligence.js';
import { HIRE_THRESHOLD, REVIEW_THRESHOLD } from '../types/hire-intelligence.js';
import { GreenhouseApplyEngine } from '../engine/greenhouse.js';
// ── Nova arquitetura de candidatura ──────────────────────────────────────────
import { ApplicationService } from '../application/ApplicationService.js';
import { ApplicationRepository } from '../application/ApplicationRepository.js';
import { ATSOptimizerAgent } from '../agents/ATSOptimizerAgent.js';
import type { ATSOptimizationResult } from '../agents/ATSOptimizerAgent.js';
import { coverLetter } from '../marketplace/plugins/cover-letter.js';
import { LearningEngine } from '../engine/learning-engine.js';
import { deployDashboard } from '../deploy/dashboard.js';

const MAX_GOVERNED_APPLICATIONS = Math.max(1, Number(process.env.VRAXIA_WORK_MAX_DAILY_APPLICATIONS ?? 8));

program
  .option('--platform <p>', 'Plataforma: linkedin | gupy | catho | all', 'all')
  .option('--dry-run', 'Nao submete — apenas escaneia e filtra')
  .option('--headless', 'Browser em modo headless')
  .option('--limit <n>', 'Maximo de aplicacoes por sessao', '10')
  .option('--vault <path>', 'Caminho do vault Obsidian', process.env.OBSIDIAN_VAULT ?? '')
  .option('--resume <path>', 'Caminho do PDF do curriculo', process.env.RESUME_PATH ?? '')
  .option('--log-questions', 'Salva perguntas e respostas em .vraxia-work/questionnaire-log')
  .option('--remote-only', 'Busca apenas vagas remotas (ignora CONFIG_SP)')
  .parse();

const opts = program.opts();
const requestedApplyLimit = Math.max(1, parseInt(opts.limit, 10) || MAX_GOVERNED_APPLICATIONS);
const governedApplyLimit = Math.min(requestedApplyLimit, MAX_GOVERNED_APPLICATIONS);

const KEYWORDS = [
  'AI Engineer',
  'LLM Engineer',
  'AI Solutions Architect',
  'Engenheiro de IA',
  'Full Stack Developer',
  'Desenvolvedor Full Stack',
  'Senior Software Engineer',
  'Node.js Developer',
  'Backend TypeScript',
];
const TITLE_BLACKLIST = ['junior', 'estagio', 'estágio', 'estagiário', 'estagiaria', 'intern', 'trainee', 'jr', 'bolsista'];

// Vagas de IA/ML sempre enviadas — bypassa HIRE_THRESHOLD (threshold é calibrado para generalistas)
const AI_FORCE_PATTERNS = [
  /\bia\b/, /intelig[eê]ncia artificial/, /artificial intelligence/i,
  /\bai engineer/i, /\bai developer/i, /\bai lead/i, /\bai architect/i, /\bai researcher/i,
  /\bai product/i, /applied ai/i, /\bai software/i, /\bai systems/i,
  /machine learning/i, /\bml engineer/i, /\bmlops\b/i, /ml researcher/i,
  /deep learning/i, /\bllm\b/i, /\bgenai\b/i, /generative ai/i, /\bnlp\b/i,
  /computer vision/i, /data scientist/i, /data science/i,
  /engenheiro de ia/i, /desenvolvedor de ia/i, /desenvolvedor ia/i,
  /especialista em ia/i, /especialista ia/i, /\bhire score/i,
];

function isAIJob(title: string): boolean {
  const t = title.toLowerCase();
  return AI_FORCE_PATTERNS.some(re => re.test(t));
}

// Keywords mais amplos para o mercado Catho (plataforma BR — menos vagas com título em inglês)
const CATHO_KEYWORDS = [
  'Engenheiro de IA',
  'Desenvolvedor IA',
  'Inteligência Artificial',
  'Machine Learning',
  'AI Engineer',
  'LLM',
  'Desenvolvedor Full Stack',
  'Full Stack',
  'Desenvolvedor Node',
  'Desenvolvedor Backend',
  'Desenvolvedor React',
  'Desenvolvedor Python',
  'Engenheiro de Software',
];

// 1ª prioridade: presencial + híbrido em São Paulo Capital
const LINKEDIN_CONFIG_SP_ONSITE: JobSearchConfig = {
  keywords: KEYWORDS,
  locations: ['São Paulo, Brazil', 'São Paulo, São Paulo, Brazil'],
  experienceLevels: ['MID_SENIOR_LEVEL', 'DIRECTOR'],
  jobTypes: ['FULL_TIME', 'CONTRACT'],
  datePosted: 'week',
  easyApplyOnly: true,
  remoteOnly: false,
  workType: 'ONSITE_HYBRID',
  companyBlacklist: [],
  titleBlacklist: TITLE_BLACKLIST,
  maxApplicationsPerRun: governedApplyLimit,
};

// 2ª prioridade: qualquer modalidade em SP (inclui remotos postados com loc. SP)
const LINKEDIN_CONFIG_SP: JobSearchConfig = {
  keywords: KEYWORDS,
  locations: ['São Paulo, Brazil', 'São Paulo, São Paulo, Brazil'],
  experienceLevels: ['MID_SENIOR_LEVEL', 'DIRECTOR'],
  jobTypes: ['FULL_TIME', 'CONTRACT'],
  datePosted: 'week',
  easyApplyOnly: true,
  remoteOnly: false,
  companyBlacklist: [],
  titleBlacklist: TITLE_BLACKLIST,
  maxApplicationsPerRun: governedApplyLimit,
};

// 3ª prioridade: vagas 100% remotas de qualquer lugar do Brasil/mundo
const LINKEDIN_CONFIG_BRASIL: JobSearchConfig = {
  keywords: KEYWORDS,
  locations: ['Brasil', 'Brazil', 'Remote'],
  experienceLevels: ['MID_SENIOR_LEVEL', 'DIRECTOR'],
  jobTypes: ['FULL_TIME', 'CONTRACT'],
  datePosted: 'week',
  easyApplyOnly: true,
  remoteOnly: true,
  companyBlacklist: [],
  titleBlacklist: TITLE_BLACKLIST,
  maxApplicationsPerRun: governedApplyLimit,
};

// 4ª prioridade: vagas com candidatura externa (Greenhouse, Lever, Workday)
// SEM filtro easyApplyOnly para capturar empresas com ATS próprio
const LINKEDIN_CONFIG_EXTERNAL: JobSearchConfig = {
  keywords: ['AI Engineer', 'LLM Engineer', 'Senior Software Engineer', 'AI Architect', 'ML Engineer'],
  locations: ['Brazil', 'Remote'],
  experienceLevels: ['MID_SENIOR_LEVEL', 'DIRECTOR'],
  jobTypes: ['FULL_TIME'],
  datePosted: 'week',
  easyApplyOnly: false,
  remoteOnly: true,
  companyBlacklist: [],
  titleBlacklist: TITLE_BLACKLIST,
  maxApplicationsPerRun: governedApplyLimit,
};

// 5ª prioridade: Uber — LinkedIn company ID 1815218, sem Easy Apply (Uber usa ATS próprio)
const LINKEDIN_CONFIG_UBER: JobSearchConfig = {
  keywords: ['Software Engineer', 'Senior Software Engineer', 'Staff Engineer', 'Backend Engineer', 'Full Stack Engineer', 'AI Engineer', 'ML Engineer'],
  locations: ['Brazil', 'São Paulo, Brazil', 'Remote'],
  experienceLevels: ['MID_SENIOR_LEVEL', 'DIRECTOR'],
  jobTypes: ['FULL_TIME'],
  datePosted: 'month',
  easyApplyOnly: false,
  remoteOnly: false,
  companyBlacklist: [],
  titleBlacklist: TITLE_BLACKLIST,
  maxApplicationsPerRun: governedApplyLimit,
  companyIds: ['1815218'],  // Uber LinkedIn company ID
};

const GUPY_CONFIG = {
  keywords: KEYWORDS,
  companyWatchlist: [
    'nubank', 'stone', 'vtex', 'ifood', 'creditas',
    'dock', 'loft', 'ambevtech', 'totvs', 'xp-investimentos',
    'hapvida',
  ],
  useGupyBoard: true,
  locations: ['Sao Paulo'],
};

// Catho — SP capital (presencial/híbrido)
const CATHO_CONFIG_SP: CathoSearchConfig = {
  keywords: CATHO_KEYWORDS,
  location: 'São Paulo',
  remote: false,
  titleBlacklist: TITLE_BLACKLIST,
};

// Catho — remoto Brasil
const CATHO_CONFIG_REMOTE: CathoSearchConfig = {
  keywords: CATHO_KEYWORDS,
  location: '',
  remote: true,
  titleBlacklist: TITLE_BLACKLIST,
};

const PERSONAL_DATA = {
  name: process.env.CANDIDATE_NAME ?? 'Samir Ricardo Almeida',
  email: process.env.LINKEDIN_EMAIL ?? '',
  phone: process.env.CANDIDATE_PHONE ?? '',
  linkedin: process.env.LINKEDIN_PROFILE_URL ?? 'https://linkedin.com/in/samir-ricardo-almeida-b23b3825b',
};

// Extrai keywords técnicas simples do título + descrição da vaga
function extractKeywords(job: Job): string[] {
  const TECH_TERMS = /\b(typescript|javascript|python|node|react|vue|angular|aws|azure|gcp|docker|kubernetes|sql|postgres|redis|graphql|rest|api|llm|ai|machine learning|devops|cloud|java|go|rust|php|ruby|spring|django|fastapi|next|nest|express)\b/gi;
  const text = `${job.title} ${job.description.slice(0, 1000)}`;
  const matches = text.match(TECH_TERMS) ?? [];
  return [...new Set(matches.map(k => k.toLowerCase()))].slice(0, 15);
}

// Estima idade da vaga em horas (undefined → assume 72h = 3 dias)
function estimateAgeHours(postedAt: string | undefined): number {
  if (!postedAt) return 72;
  try { return Math.max(0, (Date.now() - new Date(postedAt).getTime()) / 3_600_000); }
  catch { return 72; }
}

// Ordena vagas da mais recente para a mais antiga — apply em < 24h tem 4x mais callback
function sortNewestFirst<T extends { postedAt?: string }>(jobs: T[]): T[] {
  return [...jobs].sort((a, b) => estimateAgeHours(a.postedAt) - estimateAgeHours(b.postedAt));
}

// Imprime motivos estruturados de descarte (WHY NOT) — ajuda a calibrar twins e thresholds
function printWhyNot(hs: HireScore): void {
  const reasons: string[] = [];
  const age = hs.marketContext.publicationAgeDays;
  if (age > 7)  reasons.push(`Publicada há ${age} dias`);
  if (hs.marketContext.competitionLevel === 'very_high') reasons.push('Competição muito alta');
  else if (hs.marketContext.competitionLevel === 'high')  reasons.push('Competição alta');
  if (hs.dimensions.atsProbability < 60)  reasons.push(`ATS fraco: ${hs.dimensions.atsProbability}%`);
  if (hs.atsKeywordsMissing.length)       reasons.push(`Missing: ${hs.atsKeywordsMissing.slice(0, 3).join(', ')}`);
  if (hs.keyWeaknesses.length)            reasons.push(hs.keyWeaknesses[0]);
  console.log(`  [WHY NOT] HS ${hs.hireScore}/100 · IP ${hs.interviewProbability}%`);
  for (const r of reasons) console.log(`    × ${r}`);
}

// Imprime plano de ação quando action=REVIEW — O QUE FAZER para chegar a APPLY
function printHowToWin(hs: HireScore): void {
  const gap = HIRE_THRESHOLD - hs.interviewProbability;
  console.log(`  [HOW TO WIN] Faltam ${gap} pontos de IP para APPLY (IP: ${hs.interviewProbability}% / HS: ${hs.hireScore}/100)`);

  const suggestions: string[] = [];
  const d = hs.dimensions;

  if (d.atsProbability < 80 && hs.atsKeywordsMissing.length)
    suggestions.push(`Adicionar keywords ao twin: ${hs.atsKeywordsMissing.slice(0, 4).join(', ')}`);
  if (d.technicalFit < 85) {
    const impact = Math.round((85 - d.technicalFit) * 0.35);
    suggestions.push(`Fortalecer stack técnico (+${impact}pts potenciais, fit atual: ${d.technicalFit}/100)`);
  }
  if (hs.marketContext.competitionLevel === 'very_high')
    suggestions.push('Competição muito alta — priorizar referral ou contato direto');
  if (hs.marketContext.publicationAgeDays > 5)
    suggestions.push(`Vaga antiga (${hs.marketContext.publicationAgeDays}d) — monitorar reposts desta empresa`);
  if (d.seniorityFit < 80)
    suggestions.push(`Destacar experiência sênior/lead (fit atual: ${d.seniorityFit}/100)`);
  if (d.salaryFit < 70)
    suggestions.push('Expectativa salarial acima do range — ajustar alvo salarial no twin');

  const top = suggestions.slice(0, 3);
  if (top.length) {
    for (const s of top) console.log(`    → ${s}`);
  } else {
    console.log('    → Score próximo do threshold — ajuste fino de keywords pode ser suficiente');
  }
}

// Imprime e persiste resultado do ATSOptimizer (cobertura de keywords JD→CV)
function printATSResult(r: ATSOptimizationResult): void {
  const delta = r.atsScoreAfter - r.atsScoreBefore;
  const arrow = delta > 0 ? `↑${delta}` : delta < 0 ? `↓${Math.abs(delta)}` : '=';
  console.log(`  [ATS] Coverage: ${r.atsScoreBefore}% → ${r.atsScoreAfter}% (${arrow})`);
  if (r.keywordsAdded.length)
    console.log(`        ✓ Incorporadas: ${r.keywordsAdded.slice(0, 5).join(', ')}`);
  if (r.keywordsMissingFromCV.length)
    console.log(`        ✗ Ainda faltando: ${r.keywordsMissingFromCV.slice(0, 3).join(', ')}`);
}

// Salva currículo otimizado em .vraxia-work/ats-optimized/<jobId>.md para futura geração de PDF
function saveOptimizedResume(r: ATSOptimizationResult, jobId: string): void {
  try {
    const dir = path.resolve(process.cwd(), '.vraxia-work', 'ats-optimized');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${jobId}.md`), r.optimizedResumeMd, 'utf-8');
  } catch { /* non-critical — best effort */ }
}

// Persiste toda decisão de gate (APPLY/REVIEW/SKIP) em decisions.jsonl.
// Essa é a fonte de dados para calibração de thresholds e análise de padrões.
function persistDecision(job: Job, hs: HireScore, twinLabel: string): void {
  try {
    const record = {
      timestamp:           new Date().toISOString(),
      jobId:               job.id,
      jobTitle:            job.title,
      company:             job.company,
      platform:            job.platform ?? 'unknown',
      twinId:              hs.twinId,
      twinLabel,
      hireScore:           hs.hireScore,
      interviewProbability: hs.interviewProbability,
      action:              hs.action,
      publicationAgeDays:  hs.marketContext.publicationAgeDays,
      competitionLevel:    hs.marketContext.competitionLevel,
      dimensions: {
        technicalFit:   hs.dimensions.technicalFit,
        seniorityFit:   hs.dimensions.seniorityFit,
        salaryFit:      hs.dimensions.salaryFit,
        atsProbability: hs.dimensions.atsProbability,
      },
      atsKeywordsFound:    hs.atsKeywordsFound,
      atsKeywordsMissing:  hs.atsKeywordsMissing,
      reasoning:           hs.reasoning,
    };
    fs.appendFileSync(
      path.join(path.resolve(process.cwd(), '.vraxia-work'), 'decisions.jsonl'),
      JSON.stringify(record) + '\n',
      'utf-8',
    );
  } catch { /* non-critical */ }
}

// Analisa decisions.jsonl ao final da sessão:
// - gate rate (% que passou para APPLY)
// - keywords recorrentemente ausentes → sugestões de melhoria dos twins
// - alerta quando gate rate está fora do range saudável (5–40%)
function analyzeDecisions(): void {
  try {
    const file = path.join(path.resolve(process.cwd(), '.vraxia-work'), 'decisions.jsonl');
    if (!fs.existsSync(file)) return;

    type D = { action: string; hireScore: number; interviewProbability: number; atsKeywordsMissing?: string[] };
    const all = fs.readFileSync(file, 'utf-8')
      .trim().split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l) as D; } catch { return null; } })
      .filter(Boolean) as D[];

    if (all.length < 5) return;

    const recent  = all.slice(-100);
    const applied  = recent.filter(d => d.action === 'APPLY').length;
    const reviewed = recent.filter(d => d.action === 'REVIEW').length;
    const skipped  = recent.filter(d => d.action === 'SKIP').length;
    const gateRate = Math.round((applied / recent.length) * 100);
    const avgHS    = Math.round(recent.reduce((s, d) => s + d.hireScore, 0) / recent.length);
    const avgIP    = Math.round(recent.reduce((s, d) => s + d.interviewProbability, 0) / recent.length);

    console.log(`\n  [CALIBRAÇÃO] Últimas ${recent.length} decisões: ${applied} APPLY · ${reviewed} REVIEW · ${skipped} SKIP`);
    console.log(`  Gate rate: ${gateRate}% | HS médio: ${avgHS} | IP médio: ${avgIP}%`);

    if (gateRate < 5 && recent.length >= 15)
      console.log('  ⚠️  Gate muito restritivo — considere ajustar HIRE_THRESHOLD ou enriquecer twins');
    else if (gateRate > 40)
      console.log('  ⚠️  Gate permissivo — monitore interview rate vs quantidade de candidaturas');

    const freq: Record<string, number> = {};
    for (const d of recent.filter(d => d.action !== 'APPLY')) {
      for (const kw of d.atsKeywordsMissing ?? []) {
        freq[kw] = (freq[kw] ?? 0) + 1;
      }
    }
    const topMissing = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .filter(([, c]) => c >= 2);

    if (topMissing.length >= 2) {
      console.log(`  Keywords recorrentes ausentes: ${topMissing.map(([kw, n]) => `${kw}(×${n})`).join(', ')}`);
      console.log('  → Adicionar ao twin para aumentar gate rate');
    }
  } catch { /* non-critical */ }
}

// ── Agent bundle ──────────────────────────────────────────────────────────────

interface HuntAgents {
  matcher: MatchAgent;             // legacy — fallback only
  questionnaire: QuestionnaireAgent;
  twinSelector: TwinSelectorAgent;
  hireScoreAgent: HireScoreAgent;
  atsOptimizer: ATSOptimizerAgent;
  twinsStore: ProfessionalTwinsStore;
}

// ── HIE scoring helper ────────────────────────────────────────────────────────
// Single entry point for scoring via HIE. Handles cache, twin selection, and logging.

async function scoreViaHIE(
  job: Job,
  agents: HuntAgents,
): Promise<HireScore> {
  // Check HIE cache first (3-day TTL)
  const cached = agents.twinsStore.getCachedHireScore(job.id);
  if (cached) {
    const twinLabel = agents.twinsStore.getById(cached.twinId)?.label ?? cached.twinId;
    console.log(`  [HIE CACHE] ${twinLabel} | IP: ${cached.interviewProbability}% | HS: ${cached.hireScore}/100 → ${cached.action}`);
    return cached;
  }

  // Select best twin for this job (Haiku — fast and cheap)
  const twins = agents.twinsStore.getAll();
  const selection = await agents.twinSelector.select(job, twins);

  // Best-of-2 twin scoring: when TwinSelector confidence < 85 % OR top-2 scores
  // are within 20 pts, score both twins with HireScoreAgent (Sonnet) and pick highest IP.
  // +1 Sonnet call on ambiguous jobs; avoids wrong twin selection on mixed-role descriptions.
  let hireScore: HireScore;
  let winnerLabel = selection.selectedTwin.label;

  const sortedScores = [...selection.allScores].sort((a, b) => b.score - a.score);
  const scoreGap     = sortedScores.length >= 2 ? sortedScores[0].score - sortedScores[1].score : 100;
  const needsBoth    = sortedScores.length >= 2 && (selection.confidence < 85 || scoreGap < 20);
  const runnerTwin   = needsBoth
    ? twins.find(t => t.id === sortedScores[1].twinId && t.id !== selection.selectedTwin.id)
    : undefined;

  if (runnerTwin) {
    const [s1, s2] = await Promise.all([
      agents.hireScoreAgent.score(job, selection.selectedTwin),
      agents.hireScoreAgent.score(job, runnerTwin),
    ]);
    if (s2.interviewProbability > s1.interviewProbability) {
      hireScore   = s2;
      winnerLabel = runnerTwin.label;
      console.log(`  [TWIN×2] ${selection.selectedTwin.label}(IP:${s1.interviewProbability}%) < ${runnerTwin.label}(IP:${s2.interviewProbability}%) → ${runnerTwin.label}`);
    } else {
      hireScore = s1;
      console.log(`  [TWIN×2] ${selection.selectedTwin.label}(IP:${s1.interviewProbability}%) ≥ ${runnerTwin.label}(IP:${s2.interviewProbability}%) → ${selection.selectedTwin.label}`);
    }
  } else {
    hireScore = await agents.hireScoreAgent.score(job, selection.selectedTwin);
  }

  agents.twinsStore.saveHireScore(hireScore);
  persistDecision(job, hireScore, winnerLabel);

  const gateStr = hireScore.action === 'APPLY' ? '✅ APPLY' : hireScore.action;
  console.log(`  [HIE] ${winnerLabel} | IP: ${hireScore.interviewProbability}% | HS: ${hireScore.hireScore}/100 → ${gateStr}`);

  if (hireScore.keyStrengths.length)
    console.log(`        ✓ ${hireScore.keyStrengths.slice(0, 3).join(' · ')}`);
  if (hireScore.keyWeaknesses.length)
    console.log(`        ✗ ${hireScore.keyWeaknesses[0]}`);
  if (hireScore.atsKeywordsMissing.length)
    console.log(`        ATS missing: ${hireScore.atsKeywordsMissing.slice(0, 4).join(', ')}`);

  return hireScore;
}

// Adapts HireScore to the minimal JobScore fields ApplicationRepository.upsert() reads
function toJobScore(hs: HireScore): JobScore {
  return {
    jobId:       hs.jobId,
    titleFit:    Math.round(hs.dimensions.technicalFit / 10),
    stackFit:    Math.round(hs.dimensions.technicalFit / 10),
    companyFit:  5,
    dealBreaker: hs.hireScore === 0,
    total:       hs.hireScore,
    action:      hs.action,
    reason:      hs.reasoning,
  };
}

// ── processJob (Gupy + Catho) ─────────────────────────────────────────────────

async function processJob(
  job: Job,
  agents: HuntAgents,
  tracker: ApplicationRepository,
  memory: CareerMemory,
  applier: (job: Job) => Promise<boolean>,
  dryRun: boolean
): Promise<boolean> {
  if (tracker.alreadyApplied(job.id)) {
    console.log(`  ↩  Ja aplicado: ${job.title} @ ${job.company}`);
    return false;
  }

  const hireScore = await scoreViaHIE(job, agents);

  tracker.upsert({
    id: job.id,
    job,
    score: toJobScore(hireScore) as unknown as JobScore,
    // REVIEW and SKIP both resolve to 'filtered_out': no automatic submission for either.
    // score_action retains 'REVIEW' or 'SKIP' so the dashboard can distinguish them.
    status: 'filtered_out' as ApplicationStatus,
  });

  const aiForce = hireScore.action !== 'APPLY' && isAIJob(job.title);
  if (hireScore.action !== 'APPLY' && !aiForce) {
    printWhyNot(hireScore);
    if (hireScore.action === 'REVIEW') printHowToWin(hireScore);
    tracker.updateState(job.id, 'cancelled', {
      notes: hireScore.reasoning,
      reasonFilter: hireScore.reasoning,
    });
    console.log(`  ${hireScore.action === 'SKIP' ? 'Pulando.' : 'Marcado para revisao manual (score_action=REVIEW).'}`);
    return false;
  }
  if (aiForce) {
    console.log(`  🤖 AI-FORCE — bypassa threshold (IP:${hireScore.interviewProbability}% / HS:${hireScore.hireScore})`);
  }

  tracker.saveExplainability(job.id, hireScore.reasoning, undefined, undefined);
  tracker.updateStatus(job.id, 'applying');

  // ATS keyword optimization — tailors CV emphasis to this specific JD (Sonnet, non-blocking)
  const _selectedTwinForATS = agents.twinsStore.getById(hireScore.twinId);
  if (_selectedTwinForATS) {
    try {
      const atsResult = await agents.atsOptimizer.optimize(job, _selectedTwinForATS);
      printATSResult(atsResult);
      saveOptimizedResume(atsResult, job.id);
    } catch (e) {
      console.warn('  [ATS] Otimização falhou — prosseguindo com CV base:', String(e).slice(0, 60));
    }
  }

  console.log(`  Aplicando${dryRun ? ' (DRY RUN)' : ''}...`);

  agents.questionnaire.setJob(job.id, job.title, job.company, job.linkedinUrl);

  try {
    const success = await applier(job);
    if (success) {
      if (dryRun) {
        tracker.updateStatus(job.id, 'queued', 'dry-run: aprovado, aguardando aplicacao real');
        console.log('  Aplicado! (simulado — mantido na fila)');
      } else {
        tracker.updateStatus(job.id, 'applied');
        memory.recordApplication(job.company, extractKeywords(job));
        console.log('  Aplicado!');
      }
      return true;
    } else {
      tracker.updateStatus(job.id, 'filtered_out', 'Nao submetido');
      return false;
    }
  } catch (err) {
    tracker.updateStatus(job.id, 'error', String(err));
    console.error('  Erro:', err);
    return false;
  } finally {
    agents.questionnaire.flushLog();
  }
}

async function main() {
  const platform = opts.platform as 'linkedin' | 'gupy' | 'catho' | 'all';
  const dryRun = !!opts.dryRun;
  const maxApply = governedApplyLimit;
  if (requestedApplyLimit !== governedApplyLimit) {
    console.log(`[Governance] Limite solicitado (${requestedApplyLimit}) reduzido para ${governedApplyLimit}.`);
  }

  console.log(`\nVRAXIA WORK — Hunt Mode [${platform.toUpperCase()}]${dryRun ? ' DRY RUN' : ''}`);
  console.log(`Hire Intelligence Engine active — HIRE_THRESHOLD: ${HIRE_THRESHOLD}/100\n`);

  // Sinaliza para a API que um hunt externo está ativo (usado pelo dashboard para polling rápido)
  const PID_FILE = path.resolve(process.cwd(), '.vraxia-work', 'hunt.pid');
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf-8');
  const cleanPid = () => { try { fs.unlinkSync(PID_FILE); } catch {} };
  process.on('exit', cleanPid);
  process.on('SIGINT', () => { cleanPid(); process.exit(130); });
  process.on('SIGTERM', () => { cleanPid(); process.exit(143); });

  const retriever = new VaultRetriever();
  if (opts.vault) {
    try {
      const loader = new ObsidianVaultLoader(opts.vault);
      const chunks = loader.load('vraxia-work');
      retriever.index(chunks);
    } catch (err) {
      console.warn('[Hunt] Vault nao carregado — contexto padrao.\n', err);
    }
  }

  // Log de perguntas sempre ativo — alimenta o relatório do dashboard e do MCP
  const logger = new QuestionnaireLogger();
  console.log('[Hunt] Log de perguntas ativo → .vraxia-work/questionnaire-log.*\n');

  const twinStore  = new TwinStore();
  const memory     = await CareerMemory.create();

  // HIE agents — Career OS v2
  const twinsStore     = await ProfessionalTwinsStore.create();
  const twinSelector   = new TwinSelectorAgent(process.env.ANTHROPIC_API_KEY);
  const hireScoreAgent = new HireScoreAgent(process.env.ANTHROPIC_API_KEY);

  console.log(`[Hunt] Professional Twins loaded: ${twinsStore.getAll().map(t => t.id).join(', ')}\n`);

  const questionnaire = new QuestionnaireAgent(retriever, process.env.ANTHROPIC_API_KEY, logger);

  // Injeta facts do twin (Camada 1)
  const twinForFacts  = twinStore.get();
  const eduFact       = twinForFacts.learning.education?.[0];
  if (twinForFacts.identity.cpf)      questionnaire.setFact('cpf',         twinForFacts.identity.cpf);
  if (twinForFacts.identity.email)    questionnaire.setFact('email',        twinForFacts.identity.email);
  if (twinForFacts.identity.linkedin) questionnaire.setFact('linkedin',     twinForFacts.identity.linkedin);
  if (twinForFacts.identity.phone)    questionnaire.setFact('telefone',     twinForFacts.identity.phone);
  if (twinForFacts.identity.name)     questionnaire.setFact('nome',         twinForFacts.identity.name);
  if (eduFact?.institution)           questionnaire.setFact('escola',       eduFact.institution);
  if (eduFact?.degree)                questionnaire.setFact('escolaridade', eduFact.degree);
  if (eduFact?.course)                questionnaire.setFact('disciplina',   eduFact.course);

  // Ativa Candidate KB (Camadas 2–5) + CKOS como RAG enriquecido
  const KB_PATH   = process.env.CANDIDATE_KB_PATH ?? 'C:\\Users\\Administrador\\Desktop\\VRAXIA SYSTEM\\VRAXIA WORK\\candidate-kb';
  const CKOS_PATH = process.env.CANDIDATE_OS_PATH  ?? 'C:\\Users\\Administrador\\Desktop\\VRAXIA SYSTEM\\VRAXIA WORK\\candidate-os';
  try {
    const kbLoader = new CandidateKBLoader(KB_PATH, CKOS_PATH);
    const kb       = new CandidateKBRetriever(kbLoader.load());
    questionnaire.useKB(kb);
  } catch (err) {
    console.warn('[Hunt] Candidate KB não carregada — usando vault RAG:', String(err).slice(0, 80));
  }

  // Ativa CandidateProfileLoader — Single Source of Truth (Camada 0)
  // Deve ser carregado APÓS o KB para que setProfileVersion() invalide cache corretamente
  const profileLoader = CandidateProfileLoader.tryLoad(KB_PATH);
  if (profileLoader) {
    questionnaire.useProfileLoader(profileLoader);
    console.log(`[Hunt] SSoT ativo — Profile v${profileLoader.getVersion()} | ${Object.keys(profileLoader.getAllFacts()).length} fatos estruturados\n`);
  }

  const atsOptimizer   = new ATSOptimizerAgent(process.env.ANTHROPIC_API_KEY);
  const learningEngine = new LearningEngine(twinsStore);

  const agents: HuntAgents = {
    matcher:       new MatchAgent(retriever, twinStore, process.env.ANTHROPIC_API_KEY),
    questionnaire,
    twinSelector,
    hireScoreAgent,
    atsOptimizer,
    twinsStore,
  };

  const tracker = await ApplicationRepository.create();
  const session = new LinkedInSession();
  const page = await session.init({ headless: !!opts.headless });
  // try/finally garante que browser e DB sejam fechados mesmo em caso de erro fatal.

  try {
  const needsLinkedIn = platform === 'linkedin' || platform === 'all';
  if (needsLinkedIn) {
    const loggedIn = await session.login({
      email: process.env.LINKEDIN_EMAIL ?? '',
      password: process.env.LINKEDIN_PASSWORD ?? '',
    });

    if (!loggedIn) {
      console.error('Falha no login LinkedIn.');
      await session.close();
      tracker.close();
      process.exit(1);
    }
  }

  const resumePath = opts.resume || path.resolve(process.cwd(), 'resume.pdf');
  let totalApplied = 0;
  const sessionATSStats: Array<{ before: number; after: number; added: number }> = [];

  if (platform === 'linkedin' || platform === 'all') {
    console.log('\nLINKEDIN — Buscando vagas (SP + Brasil/Remoto)...');
    const searchEngine = new JobSearchEngine(page);
    const appService   = new ApplicationService(page, tracker);
    const ghEngine     = new GreenhouseApplyEngine(page, retriever, process.env.ANTHROPIC_API_KEY);
    const twin         = twinStore.get();

    const remoteOnly = !!opts.remoteOnly;

    const jobsSPOnsite  = remoteOnly ? [] : await searchEngine.scrapeJobList(LINKEDIN_CONFIG_SP_ONSITE).catch(e => { console.warn('[Hunt] Busca SP onsite falhou:', e); return []; });
    const jobsSP        = remoteOnly ? [] : await searchEngine.scrapeJobList(LINKEDIN_CONFIG_SP).catch(e => { console.warn('[Hunt] Busca SP falhou:', e); return []; });
    const jobsBR        = await searchEngine.scrapeJobList(LINKEDIN_CONFIG_BRASIL).catch(e => { console.warn('[Hunt] Busca BR falhou:', e); return []; });
    const jobsExternal  = await searchEngine.scrapeJobList(LINKEDIN_CONFIG_EXTERNAL).catch(e => { console.warn('[Hunt] Busca externa falhou:', e); return []; });
    const jobsUber      = await searchEngine.scrapeJobList(LINKEDIN_CONFIG_UBER).catch(e => { console.warn('[Hunt] Busca Uber falhou:', e); return []; });

    const seenIds = new Set<string>();
    const rawLinkedInJobs = [...jobsSPOnsite, ...jobsSP, ...jobsBR, ...jobsExternal, ...jobsUber].filter(j => { if (seenIds.has(j.id)) return false; seenIds.add(j.id); return true; });
    const jobs = sortNewestFirst(rawLinkedInJobs); // newest-first: < 24h tem 4x mais callback
    console.log(`${jobs.length} vagas únicas encontradas no LinkedIn (SP onsite/híbrido: ${jobsSPOnsite.length}, SP geral: ${jobsSP.length}, BR/Remoto: ${jobsBR.length}, Externa/ATS: ${jobsExternal.length}, Uber: ${jobsUber.length}) — ordenadas por data.\n`);

    for (const job of jobs) {
      if (totalApplied >= maxApply) break;
      console.log(`\n${job.title} @ ${job.company}`);
      job.description = await searchEngine.scrapeJobDescription(job.linkedinUrl);

      // Detecta tipo de candidatura (Easy Apply vs ATS externo)
      const atsResult = await searchEngine.detectApplyType().catch((): { type: 'easy_apply'; externalUrl?: string } => ({ type: 'easy_apply' }));
      job.applyType        = atsResult.type;
      job.externalApplyUrl = atsResult.externalUrl;
      if (atsResult.type !== 'easy_apply') {
        console.log(`  [ATS] ${atsResult.type.toUpperCase()}${atsResult.externalUrl ? ` → ${atsResult.externalUrl.slice(0, 60)}` : ''}`);
      }

      // ── Greenhouse (ATS externo implementado) ─────────────────────────────
      if (job.applyType === 'greenhouse') {
        if (!job.externalApplyUrl) {
          tracker.updateState(job.id, 'cancelled', { notes: 'Greenhouse — URL não detectada' });
          continue;
        }
        agents.questionnaire.setAtsSource('greenhouse');
        const ghOk = await processJob(job, agents, tracker, memory, async (j) => {
          // Cover letter gerada por Sonnet, salva em .vraxia-work/cover-letters/<jobId>.txt
          try {
            const clResult = await coverLetter.execute({
              twin, apiKey: process.env.ANTHROPIC_API_KEY,
              input: j.description, intent: 'HUNT',
              jobId: j.id, jobTitle: j.title, company: j.company, jobDescription: j.description,
            });
            const letter = (clResult.data as { letter?: string })?.letter ?? '';
            if (letter) {
              const clDir = path.resolve(process.cwd(), '.vraxia-work', 'cover-letters');
              if (!fs.existsSync(clDir)) fs.mkdirSync(clDir, { recursive: true });
              fs.writeFileSync(path.join(clDir, `${j.id}.txt`), letter, 'utf-8');
              console.log(`  [CARTA] Gerada para ${j.company} → .vraxia-work/cover-letters/${j.id}.txt`);
            }
          } catch (e) {
            console.warn('  [CARTA] Geração falhou — prosseguindo sem carta:', String(e).slice(0, 60));
          }
          return ghEngine.apply(j.externalApplyUrl!, {
            twin, resumePath, dryRun,
            onQuestion: async (q) => (await agents.questionnaire.answer(q)).answer,
            onFieldFilled: (label, value) => agents.questionnaire.logField(label, value),
          });
        }, dryRun);
        if (ghOk) { totalApplied++; await new Promise(r => setTimeout(r, 4000 + Math.random() * 6000)); }
        continue;
      }

      // ── ATSs pendentes ────────────────────────────────────────────────────
      if (job.applyType === 'lever' || job.applyType === 'workday' || job.applyType === 'external') {
        const msg = `ATS ${job.applyType} — não implementado nesta versão`;
        tracker.updateState(job.id, 'cancelled', { notes: msg });
        console.log(`  ${msg}`);
        continue;
      }

      // ── LinkedIn Easy Apply via ApplicationService (máquina de estados) ────
      agents.questionnaire.setAtsSource('easy_apply');

      if (tracker.alreadyApplied(job.id)) {
        console.log(`  ↩  Já aplicado: ${job.title} @ ${job.company}`);
        continue;
      }

      // ── HIE scoring gate ──────────────────────────────────────────────────
      // Replaces MatchAgent.score(). Decision: APPLY only if hireScore >= HIRE_THRESHOLD (90).
      const hireScore = await scoreViaHIE(job, agents);

      // Upsert is safe here: job was not terminal (checked above via alreadyApplied).
      // REVIEW and SKIP both map to 'filtered_out': neither will receive an automatic submission.
      // score_action is stored as 'REVIEW'|'SKIP'|'APPLY' so dashboard can filter correctly.
      tracker.upsert({
        id: job.id,
        job,
        score: toJobScore(hireScore) as unknown as JobScore,
        status: hireScore.action === 'APPLY' ? 'queued' : 'filtered_out',
      });

      const aiForceLinkedIn = hireScore.action !== 'APPLY' && isAIJob(job.title);
      if (hireScore.action !== 'APPLY' && !aiForceLinkedIn) {
        printWhyNot(hireScore);
        if (hireScore.action === 'REVIEW') printHowToWin(hireScore);
        tracker.updateState(job.id, 'cancelled', {
          notes: hireScore.reasoning,
          reasonFilter: hireScore.reasoning,
        });
        console.log(`  ${hireScore.action === 'SKIP' ? 'Pulando.' : 'Marcado para revisao manual (score_action=REVIEW).'}`);
        continue;
      }
      if (aiForceLinkedIn) {
        console.log(`  🤖 AI-FORCE — bypassa threshold (IP:${hireScore.interviewProbability}% / HS:${hireScore.hireScore})`);
      }

      tracker.saveExplainability(job.id, hireScore.reasoning, undefined, undefined);
      tracker.updateState(job.id, 'starting');

      // ATS optimization — call before submit, log delta, save optimized MD
      const _linkedInTwin = agents.twinsStore.getById(hireScore.twinId);
      if (_linkedInTwin) {
        try {
          const atsResult = await agents.atsOptimizer.optimize(job, _linkedInTwin);
          printATSResult(atsResult);
          saveOptimizedResume(atsResult, job.id);
          sessionATSStats.push({ before: atsResult.atsScoreBefore, after: atsResult.atsScoreAfter, added: atsResult.keywordsAdded.length });
        } catch (e) {
          console.warn('  [ATS] Otimização falhou — prosseguindo com CV base:', String(e).slice(0, 60));
        }
      }

      console.log(`  Candidatando${dryRun ? ' (DRY RUN)' : ''}...`);

      agents.questionnaire.setJob(job.id, job.title, job.company, job.linkedinUrl);

      const result = await appService.process(job, {
        dryRun,
        resumePath,
        onQuestion: async (q) => (await agents.questionnaire.answer(q)).answer,
        onFieldFilled: (label, value) => agents.questionnaire.logField(label, value),
        onStateChange: (state) => {
          console.log(`    [state] ${state}`);
        },
        maxRetries: 1,
      });

      agents.questionnaire.flushLog();

      if (result.confirmed) {
        memory.recordApplication(job.company, extractKeywords(job));
        console.log(`  ✅ Candidatura CONFIRMADA (método: ${result.validation?.method ?? 'desconhecido'})`);
        console.log(`  📁 Evidências: ${result.evidenceDir}`);
        totalApplied++;
        await new Promise(r => setTimeout(r, 4000 + Math.random() * 6000));
      } else if (result.finalState === 'submitted') {
        console.log(`  ⚠️  Submetido mas NÃO confirmado — revisar evidências: ${result.evidenceDir}`);
      } else {
        console.log(`  ✗ Falha: ${result.error ?? result.finalState}`);
      }
    }
  }

  if ((platform === 'gupy' || platform === 'all') && totalApplied < maxApply) {
    console.log('\nGUPY — Buscando vagas...');
    const gupySearch = new GupySearchEngine(page);
    const gupyApply = new GupyApplyEngine(page);

    // API HTTP (primary — evita Cloudflare/bot-detection dos subdomínios)
    const uniqueJobs = sortNewestFirst(await gupySearch.searchViaAPI(GUPY_CONFIG));
    console.log(`${uniqueJobs.length} vagas encontradas no Gupy (ordenadas por data).\n`);

    for (const job of uniqueJobs) {
      if (totalApplied >= maxApply) break;
      console.log(`\n[Gupy] ${job.title} @ ${job.company}`);
      job.description = await gupySearch.scrapeJobDescription(job);

      const applied = await processJob(job, agents, tracker, memory, async (j) => {
        return gupyApply.apply(j as GupyJob, {
          resumePath, dryRun, personalData: PERSONAL_DATA,
          onQuestion: async (q) => (await agents.questionnaire.answer(q)).answer,
        });
      }, dryRun);

      if (applied) {
        totalApplied++;
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000));
      }
    }
  }

  if ((platform === 'catho' || platform === 'all') && totalApplied < maxApply) {
    console.log('\nCATHO — Buscando vagas (SP + Remoto)...');

    const cathoSession = new CathoSession(page);
    const cathoLoggedIn = await cathoSession.login();
    if (!cathoLoggedIn) {
      console.error('[Catho] Falha no login — pulando plataforma.');
    } else {
      const cathoSearch = new CathoSearchEngine(page);
      const cathoApply  = new CathoApplyEngine(page);

      const jobsSP     = await cathoSearch.searchJobs(CATHO_CONFIG_SP).catch(e => { console.warn('[Catho] Busca SP falhou:', e); return [] as CathoJob[]; });
      const jobsRemote = await cathoSearch.searchJobs(CATHO_CONFIG_REMOTE).catch(e => { console.warn('[Catho] Busca remoto falhou:', e); return [] as CathoJob[]; });

      const seenCatho = new Set<string>();
      const cathoJobs = sortNewestFirst([...jobsSP, ...jobsRemote].filter(j => { if (seenCatho.has(j.id)) return false; seenCatho.add(j.id); return true; }));
      console.log(`${cathoJobs.length} vagas únicas encontradas no Catho (SP: ${jobsSP.length}, Remoto: ${jobsRemote.length}) — ordenadas por data.\n`);

      for (const job of cathoJobs) {
        if (totalApplied >= maxApply) break;
        console.log(`\n[Catho] ${job.title} @ ${job.company}`);
        job.description = await cathoSearch.scrapeJobDescription(job.applicationUrl);

        const applied = await processJob(job, agents, tracker, memory, async (j) => {
          return cathoApply.apply(j as CathoJob, {
            resumePath, dryRun,
            onQuestion: async (q) => (await agents.questionnaire.answer(q)).answer,
          });
        }, dryRun);

        if (applied) {
          totalApplied++;
          // Anti-ban: 45s–2min entre candidaturas no Catho
          await new Promise(r => setTimeout(r, 45000 + Math.random() * 75000));
        }
      }
    }
  }

  // ── HIE session summary ───────────────────────────────────────────────────
  console.log('\n─────────────────────────────────');
  console.log('RELATORIO FINAL');
  const stats = tracker.getStats();
  for (const [status, count] of Object.entries(stats)) {
    console.log(`  ${status}: ${count}`);
  }
  console.log(`  Aplicacoes nesta sessao: ${totalApplied}/${maxApply}`);

  // HIE stats: how many scored, how many passed the gate
  const hieApplied  = stats['applied'] ?? 0;
  const hieFiltered = stats['filtered_out'] ?? 0;
  const hieTotal    = hieApplied + hieFiltered;
  if (hieTotal > 0) {
    const gateRate = Math.round((hieApplied / hieTotal) * 100);
    console.log(`  HIE gate rate: ${gateRate}% passed (threshold: HS >= ${HIRE_THRESHOLD})`);
  }
  if (sessionATSStats.length > 0) {
    const avgBefore = Math.round(sessionATSStats.reduce((s, x) => s + x.before, 0) / sessionATSStats.length);
    const avgAfter  = Math.round(sessionATSStats.reduce((s, x) => s + x.after,  0) / sessionATSStats.length);
    const avgAdded  = Math.round(sessionATSStats.reduce((s, x) => s + x.added,  0) / sessionATSStats.length);
    console.log(`  ATS coverage médio: ${avgBefore}% → ${avgAfter}% (+${avgAdded} keywords/candidatura)`);
  }

  // LearningEngine — interview rate by twin/stack (shows only when patterns exist with >= 3 apps)
  try {
    const insights = learningEngine.getInsightsSummary();
    const activeTwins = insights.topTwins.filter(t => t.totalApplications >= 3);
    if (activeTwins.length > 0) {
      const overallPct = Math.round(insights.overallInterviewRate * 100);
      console.log(`  Interview Rate acumulado: ${overallPct}%`);
      console.log('  Performance por twin:');
      for (const t of activeTwins) {
        const ir = Math.round(t.interviewRate * 100);
        console.log(`    ${t.patternKey}: ${ir}% IR · ${t.interviews}/${t.totalApplications} interviews`);
      }
      const topStack = insights.topStacks.filter(s => s.totalApplications >= 2 && s.interviewRate > 0).slice(0, 3);
      if (topStack.length) {
        console.log('  Top stacks com entrevista: ' + topStack.map(s => `${s.patternKey} (${Math.round(s.interviewRate * 100)}%)`).join(', '));
      }
    }
  } catch { /* non-critical */ }

  analyzeDecisions();

  console.log('─────────────────────────────────\n');

  await deployDashboard(); // sempre — dry-run ou não

  } finally {
    // Garante cleanup mesmo em throw inesperado
    await session.close().catch(() => {});
    tracker.close();
    twinsStore.close();
    memory.close();
  }
}

main().catch(err => { console.error('Erro fatal:', err); process.exit(1); });
