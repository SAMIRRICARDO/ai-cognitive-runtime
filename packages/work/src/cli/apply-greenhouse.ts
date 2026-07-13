// apply-greenhouse.ts — aplica diretamente a uma vaga Greenhouse e atualiza o dashboard
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { chromium } from 'playwright';
import { ObsidianVaultLoader } from '../rag/vault-loader.js';
import { VaultRetriever } from '../rag/retriever.js';
import { CandidateKBLoader } from '../rag/candidate-kb-loader.js';
import { CandidateKBRetriever } from '../rag/candidate-kb-retriever.js';
import { GreenhouseApplyEngine } from '../engine/greenhouse.js';
import { QuestionnaireAgent } from '../agents/QuestionnaireAgent.js';
import { QuestionnaireLogger } from '../agents/QuestionnaireLogger.js';
import { TwinStore } from '../twin/candidate-twin.js';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), override: false });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false });

const GREENHOUSE_URL = process.argv[2] ?? 'https://job-boards.greenhouse.io/enforce/jobs/6017273004';
const DRY_RUN        = process.argv.includes('--dry-run');
const RESUME_PATH    = process.env.RESUME_PATH ?? path.resolve(process.cwd(), 'resume.pdf');
const VAULT_PATH     = process.env.OBSIDIAN_VAULT ?? '';
const KB_PATH        = process.env.CANDIDATE_KB_PATH ?? 'C:\\Users\\Administrador\\Desktop\\VRAXIA SYSTEM\\VRAXIA WORK\\candidate-kb';
const CKOS_PATH      = process.env.CANDIDATE_OS_PATH  ?? 'C:\\Users\\Administrador\\Desktop\\VRAXIA SYSTEM\\VRAXIA WORK\\candidate-os';
const WORK_DIR       = path.resolve(process.cwd(), '.vraxia-work');
const DASH_DIR       = path.resolve(process.cwd(), 'dashboard');

async function main() {
  console.log(`\n[Greenhouse] URL: ${GREENHOUSE_URL}`);
  console.log(`[Greenhouse] Modo: ${DRY_RUN ? 'DRY RUN' : 'REAL'}\n`);

  // Extrai company e job_id da URL
  const ghMatch = GREENHOUSE_URL.match(/greenhouse\.io\/([^/]+)\/jobs\/(\d+)/);
  const company = ghMatch?.[1] ?? 'greenhouse';
  const jobId   = `gh_${ghMatch?.[2] ?? Date.now()}`;

  // ── RAG ────────────────────────────────────────────────────────────────────
  const retriever = new VaultRetriever();
  if (VAULT_PATH) {
    try {
      const loader = new ObsidianVaultLoader(VAULT_PATH);
      const chunks = loader.load('vraxia-work');
      retriever.index(chunks);
      console.log(`[RAG] ${chunks.length} chunks carregados do vault.`);
    } catch (err) {
      console.warn('[RAG] Vault não carregado — contexto padrão.', String(err).slice(0, 80));
    }
  } else {
    console.log('[RAG] OBSIDIAN_VAULT não definido — retriever vazio.');
  }

  // ── Twin ───────────────────────────────────────────────────────────────────
  const twinStore = new TwinStore();
  const twin      = twinStore.get();

  // ── Logger + QuestionnaireAgent ────────────────────────────────────────────
  const logger = new QuestionnaireLogger();
  logger.setJob(jobId, 'Vaga Greenhouse', company, GREENHOUSE_URL);
  logger.setAtsSource('greenhouse');

  const questionnaire = new QuestionnaireAgent(
    retriever,
    process.env.ANTHROPIC_API_KEY ?? '',
    logger,
  );

  // Injeta dados do twin como facts determinísticos (Camada 1)
  const edu = twin.learning.education?.[0];
  if (twin.identity.cpf)      questionnaire.setFact('cpf',          twin.identity.cpf);
  if (twin.identity.linkedin) questionnaire.setFact('linkedin',     twin.identity.linkedin);
  if (twin.identity.phone)    questionnaire.setFact('telefone',     twin.identity.phone);
  if (edu?.institution)       questionnaire.setFact('escola',       edu.institution);
  if (edu?.degree)            questionnaire.setFact('escolaridade', edu.degree);
  if (edu?.course)            questionnaire.setFact('disciplina',   edu.course);

  // Ativa Candidate KB (Camadas 2–5) + CKOS como RAG enriquecido
  try {
    const kbLoader = new CandidateKBLoader(KB_PATH, CKOS_PATH);
    const kb       = new CandidateKBRetriever(kbLoader.load());
    questionnaire.useKB(kb);
  } catch (err) {
    console.warn('[KB] Não carregada — usando vault RAG:', String(err).slice(0, 80));
  }

  // ── Browser ────────────────────────────────────────────────────────────────
  console.log('[Browser] Iniciando...');
  const browser = await chromium.launchPersistentContext(
    path.resolve(process.cwd(), '.linkedin-profile'),
    { headless: false, slowMo: 80 },
  );
  const page = browser.pages()[0] ?? await browser.newPage();

  try {
    const engine = new GreenhouseApplyEngine(page, retriever, process.env.ANTHROPIC_API_KEY);
    let fieldsLogged = 0;

    const applied = await engine.apply(GREENHOUSE_URL, {
      twin,
      resumePath: RESUME_PATH,
      dryRun: DRY_RUN,

      onQuestion: async (q) => {
        const result = await questionnaire.answer(q);
        console.log(`  [Q] ${q.text}`);
        console.log(`  [A] ${result.answer}`);
        return result.answer;
      },

      onFieldFilled: (label, value) => {
        questionnaire.logField(label, String(value));
        fieldsLogged++;
        console.log(`  [Campo] ${label} → ${String(value).slice(0, 80)}`);
      },
    });

    logger.flush();
    console.log(`\n[Resultado] ${applied ? '✅ Candidatura enviada!' : '⚠️  Não aplicado (dry-run ou falha)'}`);
    console.log(`[Resultado] Campos preenchidos: ${fieldsLogged}`);

  } finally {
    await browser.close();
  }

  // ── Deploy ─────────────────────────────────────────────────────────────────
  await deployDashboard();
}

async function deployDashboard(): Promise<void> {
  const JSONL_SRC = path.join(WORK_DIR, 'questionnaire-log.jsonl');
  const SNAP_DEST = path.join(DASH_DIR, 'questionnaire-data.json');

  console.log('\n[Deploy] Exportando snapshot...');
  try {
    if (fs.existsSync(JSONL_SRC)) {
      type Entry = Record<string, unknown>;
      const entries = fs.readFileSync(JSONL_SRC, 'utf-8')
        .split('\n').filter(l => l.trim())
        .map(l => { try { return JSON.parse(l) as Entry; } catch { return null; } })
        .filter(Boolean) as Entry[];

      const grouped: Record<string, { job_id: string; job_title: string; company: string; job_url: string; entries: Entry[] }> = {};
      for (const e of entries) {
        const key = (e['job_id'] as string) || 'unknown';
        if (!grouped[key]) {
          grouped[key] = {
            job_id:    e['job_id'] as string,
            job_title: e['job_title'] as string,
            company:   e['company'] as string,
            job_url:   (e['job_url'] as string) ?? '',
            entries:   [],
          };
        }
        grouped[key].entries.push(e);
      }

      fs.writeFileSync(SNAP_DEST, JSON.stringify(Object.values(grouped)), 'utf-8');
      console.log(`[Deploy] ${entries.length} entradas → ${Object.keys(grouped).length} grupos`);
    }

    console.log('[Deploy] Publicando dashboard no Vercel...');
    const out = execSync('vercel --prod --yes 2>&1', { cwd: DASH_DIR }).toString().trim();
    const urlMatch = out.match(/https:\/\/\S+\.vercel\.app/);
    console.log(`[Deploy] ✅ Dashboard atualizado${urlMatch ? ': ' + urlMatch[0] : ' no Vercel'}`);
  } catch (err) {
    console.warn('[Deploy] Aviso — falha no deploy:', String(err).slice(0, 120));
  }
}

main().catch(err => { console.error('Erro fatal:', err); process.exit(1); });
