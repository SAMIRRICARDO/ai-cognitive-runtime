// packages/work/src/cli/hunt.ts
// VRAXIA WORK — Hunt Mode (LinkedIn + Gupy)
// Uso: tsx src/cli/hunt.ts [--platform linkedin|gupy|all] [--dry-run] [--headless]

import { program } from 'commander';
import path from 'path';
import fs from 'fs';

// Carrega .env manualmente (sem dependência de dotenv)
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
    if (m) process.env[m[1]] ??= m[2].trim();
  }
}
import { LinkedInSession } from '../engine/session.js';
import { JobSearchEngine } from '../engine/search.js';
import { EasyApplyEngine } from '../engine/apply.js';
import { GupySearchEngine, GupyApplyEngine, GupyJob } from '../engine/gupy.js';
import { ObsidianVaultLoader } from '../rag/vault-loader.js';
import { VaultRetriever } from '../rag/retriever.js';
import { JobFilterAgent } from '../agents/JobFilterAgent.js';
import { QuestionnaireAgent } from '../agents/QuestionnaireAgent.js';
import { QuestionnaireLogger } from '../agents/QuestionnaireLogger.js';
import { StatusTracker } from '../agents/StatusTracker.js';
import { JobSearchConfig, Job, ApplicationStatus } from '../types/index.js';

program
  .option('--platform <p>', 'Plataforma: linkedin | gupy | all', 'all')
  .option('--dry-run', 'Nao submete — apenas escaneia e filtra')
  .option('--headless', 'Browser em modo headless')
  .option('--limit <n>', 'Maximo de aplicacoes por sessao', '10')
  .option('--vault <path>', 'Caminho do vault Obsidian', process.env.OBSIDIAN_VAULT ?? '')
  .option('--resume <path>', 'Caminho do PDF do curriculo', process.env.RESUME_PATH ?? '')
  .option('--log-questions', 'Salva perguntas e respostas em .vraxia-work/questionnaire-log')
  .option('--remote-only', 'Busca apenas vagas remotas (ignora CONFIG_SP)')
  .parse();

const opts = program.opts();

const KEYWORDS = ['AI Engineer', 'LLM Engineer', 'AI Solutions Architect', 'AI Architect', 'Engenheiro de IA'];
const TITLE_BLACKLIST = ['junior', 'estagio', 'intern', 'trainee', 'jr'];

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
  maxApplicationsPerRun: parseInt(opts.limit, 10),
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
  maxApplicationsPerRun: parseInt(opts.limit, 10),
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
  maxApplicationsPerRun: parseInt(opts.limit, 10),
};

const GUPY_CONFIG = {
  keywords: KEYWORDS,
  companyWatchlist: [
    'nubank', 'stone', 'vtex', 'ifood', 'creditas',
    'dock', 'loft', 'ambevtech', 'totvs', 'xp-investimentos',
  ],
  useGupyBoard: true,
  locations: ['Sao Paulo'],
};

const PERSONAL_DATA = {
  name: process.env.CANDIDATE_NAME ?? 'Ricardo Almeida',
  email: process.env.LINKEDIN_EMAIL ?? '',
  phone: process.env.CANDIDATE_PHONE ?? '',
  linkedin: 'https://linkedin.com/in/ricardo-almeida',
};

async function processJob(
  job: Job,
  agents: { filter: JobFilterAgent; questionnaire: QuestionnaireAgent },
  tracker: StatusTracker,
  applier: (job: Job) => Promise<boolean>,
  dryRun: boolean
): Promise<boolean> {
  if (tracker.alreadyApplied(job.id)) {
    console.log(`  ↩  Ja aplicado: ${job.title} @ ${job.company}`);
    return false;
  }

  const score = await agents.filter.score(job);
  console.log(`  Score: ${score.total}/30 -> ${score.action} | ${score.reason}`);

  tracker.upsert({
    id: job.id,
    job,
    score,
    status: (score.action === 'SKIP' ? 'filtered_out' : 'queued') as ApplicationStatus,
  });

  if (score.action !== 'APPLY') {
    console.log(`  ${score.action === 'SKIP' ? 'Pulando.' : 'Marcado para revisao manual.'}`);
    return false;
  }

  tracker.updateStatus(job.id, 'applying');
  console.log(`  Aplicando${dryRun ? ' (DRY RUN)' : ''}...`);

  // Informa o agente sobre a vaga atual — necessário para o log e contexto de resposta
  agents.questionnaire.setJob(job.id, job.title, job.company, job.linkedinUrl);

  try {
    const success = await applier(job);
    if (success) {
      tracker.updateStatus(job.id, 'applied');
      console.log('  Aplicado!');
      return true;
    } else {
      // Applier retornou false = não submetido (não é Easy Apply, dry-run, etc.) — não é erro
      tracker.updateStatus(job.id, 'filtered_out', 'Nao submetido');
      return false;
    }
  } catch (err) {
    tracker.updateStatus(job.id, 'error', String(err));
    console.error('  Erro:', err);
    return false;
  } finally {
    // Grava resumo .md da candidatura — no-op se --log-questions não foi passado
    agents.questionnaire.flushLog();
  }
}

async function main() {
  const platform = opts.platform as 'linkedin' | 'gupy' | 'all';
  const dryRun = !!opts.dryRun;
  const maxApply = parseInt(opts.limit, 10);

  console.log(`\nVRAXIA WORK — Hunt Mode [${platform.toUpperCase()}]${dryRun ? ' DRY RUN' : ''}\n`);

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

  const logger = opts.logQuestions ? new QuestionnaireLogger() : undefined;
  if (logger) console.log('[Hunt] Log de perguntas ativo → .vraxia-work/questionnaire-log.*\n');

  const agents = {
    filter:        new JobFilterAgent(retriever, process.env.ANTHROPIC_API_KEY),
    questionnaire: new QuestionnaireAgent(retriever, process.env.ANTHROPIC_API_KEY, logger),
  };

  const tracker = await StatusTracker.create();
  const session = new LinkedInSession();
  const page = await session.init({ headless: !!opts.headless });

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

  const resumePath = opts.resume || path.resolve(process.cwd(), 'resume.pdf');
  let totalApplied = 0;

  if (platform === 'linkedin' || platform === 'all') {
    console.log('\nLINKEDIN — Buscando vagas (SP + Brasil/Remoto)...');
    const searchEngine = new JobSearchEngine(page);
    const applyEngine = new EasyApplyEngine(page);

    const remoteOnly = !!opts.remoteOnly;

    // Sequencial — prioridade: SP onsite/híbrido → SP geral → Brasil/Remoto
    const jobsSPOnsite = remoteOnly ? [] : await searchEngine.scrapeJobList(LINKEDIN_CONFIG_SP_ONSITE).catch(e => { console.warn('[Hunt] Busca SP onsite falhou:', e); return []; });
    const jobsSP = remoteOnly ? [] : await searchEngine.scrapeJobList(LINKEDIN_CONFIG_SP).catch(e => { console.warn('[Hunt] Busca SP falhou:', e); return []; });
    const jobsBR = await searchEngine.scrapeJobList(LINKEDIN_CONFIG_BRASIL).catch(e => { console.warn('[Hunt] Busca BR falhou:', e); return []; });

    const seenIds = new Set<string>();
    const jobs = [...jobsSPOnsite, ...jobsSP, ...jobsBR].filter(j => { if (seenIds.has(j.id)) return false; seenIds.add(j.id); return true; });
    console.log(`${jobs.length} vagas únicas encontradas no LinkedIn (SP onsite/híbrido: ${jobsSPOnsite.length}, SP geral: ${jobsSP.length}, BR/Remoto: ${jobsBR.length}).\n`);

    for (const job of jobs) {
      if (totalApplied >= maxApply) break;
      console.log(`\n${job.title} @ ${job.company}`);
      job.description = await searchEngine.scrapeJobDescription(job.linkedinUrl);

      const applied = await processJob(job, agents, tracker, async (j) => {
        return applyEngine.apply(j.linkedinUrl, {
          resumePath, dryRun,
          onQuestion: async (q) => (await agents.questionnaire.answer(q)).answer,
        });
      }, dryRun);

      if (applied) {
        totalApplied++;
        await new Promise(r => setTimeout(r, 4000 + Math.random() * 6000));
      }
    }
  }

  if ((platform === 'gupy' || platform === 'all') && totalApplied < maxApply) {
    console.log('\nGUPY — Buscando vagas...');
    const gupySearch = new GupySearchEngine(page);
    const gupyApply = new GupyApplyEngine(page);

    const [boardResult, watchlistResult] = await Promise.allSettled([
      gupySearch.searchBoard(GUPY_CONFIG),
      gupySearch.searchCompanyBoards(GUPY_CONFIG),
    ]);

    const gupyJobs: GupyJob[] = [
      ...(boardResult.status === 'fulfilled' ? boardResult.value : []),
      ...(watchlistResult.status === 'fulfilled' ? watchlistResult.value : []),
    ];

    const seen = new Set<string>();
    const uniqueJobs = gupyJobs.filter(j => { if (seen.has(j.id)) return false; seen.add(j.id); return true; });
    console.log(`${uniqueJobs.length} vagas encontradas no Gupy.\n`);

    for (const job of uniqueJobs) {
      if (totalApplied >= maxApply) break;
      console.log(`\n[Gupy] ${job.title} @ ${job.company}`);
      job.description = await gupySearch.scrapeJobDescription(job);

      const applied = await processJob(job, agents, tracker, async (j) => {
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

  console.log('\n─────────────────────────────────');
  console.log('RELATORIO FINAL');
  const stats = tracker.getStats();
  for (const [status, count] of Object.entries(stats)) {
    console.log(`  ${status}: ${count}`);
  }
  console.log(`  Aplicacoes nesta sessao: ${totalApplied}/${maxApply}`);
  console.log('─────────────────────────────────\n');

  await session.close();
  tracker.close();
}

main().catch(err => { console.error('Erro fatal:', err); process.exit(1); });
