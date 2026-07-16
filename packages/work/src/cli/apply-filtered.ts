// packages/work/src/cli/apply-filtered.ts
// Submete candidaturas para vagas que foram filtradas mas têm IP >= 65.
// Uso: tsx src/cli/apply-filtered.ts [--dry-run] [--limit <n>] [--min-ip <n>]

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import initSqlJs from 'sql.js';
import { program } from 'commander';
import { LinkedInSession } from '../engine/session.js';
import { JobSearchEngine } from '../engine/search.js';
import { CathoSession, CathoApplyEngine } from '../engine/catho.js';
import { VaultRetriever } from '../rag/retriever.js';
import { CandidateKBLoader } from '../rag/candidate-kb-loader.js';
import { CandidateKBRetriever } from '../rag/candidate-kb-retriever.js';
import { CandidateProfileLoader } from '../rag/candidate-profile-loader.js';
import { TwinStore } from '../twin/candidate-twin.js';
import { ProfessionalTwinsStore } from '../twin/professional-twins.js';
import { CareerMemory } from '../memory/career-memory.js';
import { QuestionnaireAgent } from '../agents/QuestionnaireAgent.js';
import { QuestionnaireLogger } from '../agents/QuestionnaireLogger.js';
import { ATSOptimizerAgent } from '../agents/ATSOptimizerAgent.js';
import { ApplicationService } from '../application/ApplicationService.js';
import { ApplicationRepository } from '../application/ApplicationRepository.js';
import { deployDashboard } from '../deploy/dashboard.js';
import type { Job, CathoJob } from '../types/index.js';
import { HIRE_THRESHOLD } from '../types/hire-intelligence.js';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), override: false });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false });

program
  .option('--dry-run', 'Não submete — apenas simula')
  .option('--limit <n>', 'Máximo de candidaturas nesta sessão', '10')
  .option('--min-ip <n>', 'IP mínimo para qualificar', '65')
  .option('--headless', 'Browser em modo headless')
  .parse();

const opts = program.opts();
const dryRun  = !!opts.dryRun;
const maxApply = parseInt(opts.limit, 10);
const minIP    = parseInt(opts.minIp, 10);

const WORK_DIR   = path.resolve(process.cwd(), '.vraxia-work');
const DB_PATH    = path.join(WORK_DIR, 'work.db');
const DECISIONS  = path.join(WORK_DIR, 'decisions.jsonl');
const RESUME_PATH = process.env.RESUME_PATH ?? path.resolve(process.cwd(), 'resume.pdf');

// Vagas excluídas por razões éticas/elegibilidade — não candidatar
const EXCLUDED_TITLES = [
  'apenas mulheres', 'only women', 'exclusivo pcd', 'exclusivo para pcd',
  'exclusivo para pessoas com tea', 'estagiário', 'estagiaria', 'estágio',
  'estagio', 'trainee', 'bolsista',
];

// Vagas de IA sempre passam — ignoram o threshold de IP
// Nota: "\bia\b" detecta "IA" como palavra isolada sem falso positivo em "engenharia"
const AI_FORCE_PATTERNS = [
  /\bia\b/,
  /intelig[eê]ncia artificial/,
  /artificial intelligence/,
  /ai engineer/,
  /ai developer/,
  /ai lead/,
  /ai architect/,
  /ai researcher/,
  /ai product/,
  /applied ai/,
  /ai software/,
  /ai systems/,
  /ai infrastructure/,
  /machine learning/,
  /\bml engineer/,
  /\bmlops\b/,
  /ml researcher/,
  /deep learning/,
  /\bllm\b/,
  /genai/,
  /generative ai/,
  /\bnlp\b/,
  /computer vision/,
  /data scientist/,
  /data science/,
  /engenheiro de ia/,
  /desenvolvedor de ia/,
  /desenvolvedor ia/,
  /especialista em ia/,
  /foco em ia/,
  /especialista ia/,
];

function isAIJob(title: string): boolean {
  const t = title.toLowerCase();
  return AI_FORCE_PATTERNS.some(re => re.test(t));
}

interface DecisionRecord {
  jobId: string;
  jobTitle: string;
  company: string;
  platform: string;
  hireScore: number;
  interviewProbability: number;
  action: string;
  twinId: string;
  reasoning: string;
}

// ── Carrega candidatos qualificados do decisions.jsonl ─────────────────────────

function loadQualified(minIp: number): DecisionRecord[] {
  if (!fs.existsSync(DECISIONS)) return [];
  const lines = fs.readFileSync(DECISIONS, 'utf-8').trim().split('\n').filter(Boolean);
  const all   = lines.map(l => { try { return JSON.parse(l) as DecisionRecord; } catch { return null; } }).filter(Boolean) as DecisionRecord[];

  // Deduplica por jobId — mantém o mais recente
  const byId = new Map<string, DecisionRecord>();
  for (const d of all) byId.set(d.jobId, d);

  return [...byId.values()]
    .filter(d => {
      if (d.action === 'APPLY') return false; // já foi aplicado
      const titleLower = d.jobTitle.toLowerCase();
      if (EXCLUDED_TITLES.some(ex => titleLower.includes(ex))) return false;
      // Vagas de IA passam sempre — independente do score
      if (isAIJob(d.jobTitle)) return true;
      if (d.interviewProbability < minIp && d.hireScore < minIp) return false;
      return true;
    })
    .sort((a, b) => {
      // Vagas de IA ficam no topo da fila
      const aAI = isAIJob(a.jobTitle) ? 1 : 0;
      const bAI = isAIJob(b.jobTitle) ? 1 : 0;
      if (bAI !== aAI) return bAI - aAI;
      return b.interviewProbability - a.interviewProbability;
    });
}

// ── Reset de estado no DB ──────────────────────────────────────────────────────
// Remove o registro do job_applications para que alreadyApplied() retorne false.

async function resetJobState(jobId: string): Promise<{ title: string; company: string; linkedinUrl: string; description: string } | null> {
  if (!fs.existsSync(DB_PATH)) return null;
  const SQL = await initSqlJs();
  const db  = new SQL.Database(fs.readFileSync(DB_PATH));

  const res = db.exec(`SELECT job_title, company, linkedin_url, description FROM job_applications WHERE id = ?`, [jobId]);
  const row = res[0]?.values?.[0] as [string, string, string, string] | undefined;

  db.exec(`DELETE FROM job_applications WHERE id = ?`, [jobId]);
  db.exec(`DELETE FROM hire_scores WHERE job_id = ?`, [jobId]);

  const data = fs.readFileSync(DB_PATH);
  const buf  = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(buf));
  db.close();

  if (!row) return null;
  return { title: row[0], company: row[1], linkedinUrl: row[2], description: row[3] ?? '' };
}

// ── Persiste ação APPLY no decisions.jsonl ────────────────────────────────────
// Evita que o mesmo job reapareça em runs futuros do apply-filtered.

function markDecisionApplied(jobId: string): void {
  if (!fs.existsSync(DECISIONS)) return;
  const lines = fs.readFileSync(DECISIONS, 'utf-8').split('\n');
  const updated = lines.map(l => {
    if (!l.trim()) return l;
    try {
      const d = JSON.parse(l) as DecisionRecord;
      if (d.jobId === jobId) return JSON.stringify({ ...d, action: 'APPLY' });
      return l;
    } catch { return l; }
  });
  fs.writeFileSync(DECISIONS, updated.join('\n'), 'utf-8');
}

// ── Monta objeto Job a partir das informações disponíveis ─────────────────────

const NOW_ISO = new Date().toISOString();

function buildLinkedInJob(d: DecisionRecord, dbData: { title: string; company: string; linkedinUrl: string; description: string } | null): Job {
  const linkedinUrl = dbData?.linkedinUrl ?? `https://www.linkedin.com/jobs/view/${d.jobId}/`;
  return {
    id:          d.jobId,
    title:       dbData?.title    ?? d.jobTitle,
    company:     dbData?.company  ?? d.company,
    location:    '',
    description: dbData?.description ?? '',
    linkedinUrl,
    platform:    'linkedin',
    postedAt:    undefined,
    scannedAt:   NOW_ISO,
    isEasyApply: true,
    applyType:   'easy_apply',
  };
}

function buildCathoJob(d: DecisionRecord, dbData: { title: string; company: string; linkedinUrl: string; description: string } | null): CathoJob {
  const cathoNumericId  = d.jobId.replace('catho_', '');
  const applicationUrl  = dbData?.linkedinUrl ?? `https://www.catho.com.br/vagas/cargo/${cathoNumericId}/`;
  return {
    id:             d.jobId,
    cathoJobId:     cathoNumericId,
    title:          dbData?.title    ?? d.jobTitle,
    company:        dbData?.company  ?? d.company,
    location:       '',
    description:    dbData?.description ?? '',
    linkedinUrl:    applicationUrl,
    applicationUrl,
    platform:       'catho',
    postedAt:       undefined,
    scannedAt:      NOW_ISO,
    isEasyApply:    false,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nVRAXIA WORK — Apply Filtered [min-IP: ${minIP}]${dryRun ? ' DRY RUN' : ''}`);
  console.log(`HIRE_THRESHOLD atual: ${HIRE_THRESHOLD}\n`);

  const qualified = loadQualified(minIP);
  if (!qualified.length) {
    console.log('Nenhuma vaga qualificada encontrada.');
    return;
  }
  console.log(`${qualified.length} vagas qualificadas encontradas (top ${Math.min(maxApply, qualified.length)} serão processadas)\n`);

  // Agentes
  const retriever      = new VaultRetriever();
  const logger         = new QuestionnaireLogger();
  const twinStore      = new TwinStore();
  const twinsStore     = await ProfessionalTwinsStore.create();
  const atsOptimizer   = new ATSOptimizerAgent(process.env.ANTHROPIC_API_KEY);
  const questionnaire  = new QuestionnaireAgent(retriever, process.env.ANTHROPIC_API_KEY, logger);
  const memory         = await CareerMemory.create();

  // Facts do twin
  const twinForFacts = twinStore.get();
  const eduFact      = twinForFacts.learning.education?.[0];
  if (twinForFacts.identity.cpf)      questionnaire.setFact('cpf',         twinForFacts.identity.cpf);
  if (twinForFacts.identity.email)    questionnaire.setFact('email',        twinForFacts.identity.email);
  if (twinForFacts.identity.linkedin) questionnaire.setFact('linkedin',     twinForFacts.identity.linkedin);
  if (twinForFacts.identity.phone)    questionnaire.setFact('telefone',     twinForFacts.identity.phone);
  if (twinForFacts.identity.name)     questionnaire.setFact('nome',         twinForFacts.identity.name);
  if (eduFact?.institution)           questionnaire.setFact('escola',       eduFact.institution);
  if (eduFact?.degree)                questionnaire.setFact('escolaridade', eduFact.degree);
  if (eduFact?.course)                questionnaire.setFact('disciplina',   eduFact.course);

  // KB + SSoT
  const KB_PATH   = process.env.CANDIDATE_KB_PATH ?? 'C:\\Users\\Administrador\\Desktop\\VRAXIA SYSTEM\\VRAXIA WORK\\candidate-kb';
  const CKOS_PATH = process.env.CANDIDATE_OS_PATH  ?? 'C:\\Users\\Administrador\\Desktop\\VRAXIA SYSTEM\\VRAXIA WORK\\candidate-os';
  try {
    const kbLoader = new CandidateKBLoader(KB_PATH, CKOS_PATH);
    questionnaire.useKB(new CandidateKBRetriever(kbLoader.load()));
  } catch { /* KB não obrigatória */ }

  const profileLoader = CandidateProfileLoader.tryLoad(KB_PATH);
  if (profileLoader) questionnaire.useProfileLoader(profileLoader);

  const tracker = await ApplicationRepository.create();
  const session = new LinkedInSession();
  const page    = await session.init({ headless: !!opts.headless });

  let linkedInLoggedIn = false;
  let cathoLoggedIn    = false;
  let totalApplied     = 0;

  try {
    for (const d of qualified) {
      if (totalApplied >= maxApply) break;

      const isLinkedIn = !d.jobId.startsWith('catho_');
      const aiForced   = isAIJob(d.jobTitle);
      console.log(`\n[${isLinkedIn ? 'LI' : 'CATHO'}] IP=${d.interviewProbability} HS=${d.hireScore}${aiForced ? ' 🤖 AI-FORCE' : ''} | ${d.jobTitle} @ ${d.company}`);

      // Reset estado no DB + recupera dados
      const dbData = await resetJobState(d.jobId);

      if (isLinkedIn) {
        // ── LinkedIn Easy Apply ────────────────────────────────────────
        if (!linkedInLoggedIn) {
          linkedInLoggedIn = await session.login({
            email:    process.env.LINKEDIN_EMAIL    ?? '',
            password: process.env.LINKEDIN_PASSWORD ?? '',
          });
          if (!linkedInLoggedIn) { console.error('  ✗ Falha no login LinkedIn — pulando vagas LI'); continue; }
        }

        const job  = buildLinkedInJob(d, dbData);
        const url  = job.linkedinUrl;
        if (!url) { console.log('  ✗ URL não disponível — pulando'); continue; }

        // Usa score original do decisions.jsonl — não re-score (LLM variance faria a decisão oscilar)
        console.log(`  [HIE cached] IP=${d.interviewProbability} HS=${d.hireScore} → APPLY (twin: ${d.twinId})`);

        // Re-insere o job na DB como 'queued' após resetJobState ter deletado o registro.
        // ApplicationService só faz UPDATE — sem registro prévio os state-transitions são perdidos.
        tracker.upsert({
          id: job.id,
          job,
          score: { jobId: job.id, titleFit: 5, stackFit: 5, companyFit: 5, dealBreaker: false, total: d.hireScore, action: 'APPLY', reason: d.reasoning ?? '' },
          status: 'queued',
          state: 'queued',
        });

        // Obtém descrição atualizada navegando até a vaga (necessária para o questionário)
        const searchEngine = new JobSearchEngine(page);
        try {
          job.description = await searchEngine.scrapeJobDescription(url);
        } catch (e) {
          console.warn('  ⚠ Falha ao obter descrição — usando dados do DB');
        }

        questionnaire.setJob(job.id, job.title, job.company, url);
        questionnaire.setAtsSource('easy_apply');

        const appService = new ApplicationService(page, tracker);
        const result = await appService.process(job, {
          dryRun,
          resumePath: RESUME_PATH,
          onQuestion:   async (q) => (await questionnaire.answer(q)).answer,
          onFieldFilled: (label, value) => questionnaire.logField(label, value),
          onStateChange: (state) => console.log(`    [state] ${state}`),
          maxRetries: 1,
        });

        questionnaire.flushLog();

        if (result.confirmed) {
          memory.recordApplication(job.company, []);
          markDecisionApplied(d.jobId);
          console.log(`  ✅ Candidatura CONFIRMADA (método: ${result.validation?.method ?? '-'})`);
          totalApplied++;
          await new Promise(r => setTimeout(r, 4000 + Math.random() * 6000));
        } else if (result.finalState === 'submitted') {
          markDecisionApplied(d.jobId);
          console.log(`  ⚠️  Submetido mas NÃO confirmado — evidências: ${result.evidenceDir}`);
          totalApplied++;
        } else {
          // Fallback: verifica truth-record.json para casos onde Truth=VERIFIED mas state=failed
          const truthFile = result.evidenceDir ? path.join(result.evidenceDir, 'truth-record.json') : '';
          if (truthFile && fs.existsSync(truthFile)) {
            try {
              const truth = JSON.parse(fs.readFileSync(truthFile, 'utf-8')) as { confidence?: string };
              if (truth.confidence === 'VERIFIED') {
                markDecisionApplied(d.jobId);
                // Registra no DB como 'confirmed' — o upsert anterior inseriu como 'queued'
                // mas o engine retornou 'failed', então forçamos o estado correto.
                tracker.updateState(d.jobId, 'confirmed', { notes: 'TruthEngine VERIFIED fallback' });
                console.log(`  ✅ Candidatura VERIFICADA via TruthEngine (state=${result.finalState})`);
                totalApplied++;
                await new Promise(r => setTimeout(r, 4000 + Math.random() * 6000));
              } else {
                console.log(`  ✗ Falha: ${result.error ?? result.finalState}`);
              }
            } catch { console.log(`  ✗ Falha: ${result.error ?? result.finalState}`); }
          } else {
            console.log(`  ✗ Falha: ${result.error ?? result.finalState}`);
          }
        }

      } else {
        // ── Catho ──────────────────────────────────────────────────────
        if (!cathoLoggedIn) {
          const cathoSession = new CathoSession(page);
          cathoLoggedIn = await cathoSession.login();
          if (!cathoLoggedIn) { console.error('  ✗ Falha no login Catho — pulando vagas Catho'); continue; }
        }

        const job      = buildCathoJob(d, dbData);
        const cathoUrl = job.applicationUrl;

        // Re-insere na DB como 'queued' após resetJobState ter deletado o registro
        tracker.upsert({
          id: job.id,
          job: { ...job, linkedinUrl: cathoUrl, isEasyApply: false },
          score: { jobId: job.id, titleFit: 5, stackFit: 5, companyFit: 5, dealBreaker: false, total: d.hireScore, action: 'APPLY', reason: d.reasoning ?? '' },
          status: 'queued',
          state: 'queued',
        });

        const cathoApply = new CathoApplyEngine(page);
        questionnaire.setJob(job.id, job.title, job.company, cathoUrl);

        try {
          const success = await cathoApply.apply(job, {
            resumePath: RESUME_PATH,
            dryRun,
            onQuestion: async (q) => (await questionnaire.answer(q)).answer,
          });
          questionnaire.flushLog();
          if (success) {
            memory.recordApplication(job.company, []);
            markDecisionApplied(d.jobId);
            console.log(`  ✅ Aplicado no Catho!`);
            totalApplied++;
            await new Promise(r => setTimeout(r, 45000 + Math.random() * 30000));
          } else {
            console.log(`  ✗ Catho não confirmou candidatura`);
          }
        } catch (e) {
          console.error(`  ✗ Erro Catho: ${String(e).slice(0, 80)}`);
        }
      }
    }
  } finally {
    await session.close().catch(() => {});
    tracker.close();
    twinsStore.close();
    memory.close();
  }

  console.log(`\n─────────────────────────────────`);
  console.log(`Candidaturas enviadas: ${totalApplied}/${Math.min(maxApply, qualified.length)}`);
  console.log(`─────────────────────────────────\n`);

  await deployDashboard();
}

main().catch(err => { console.error('Erro fatal:', err); process.exit(1); });
