// packages/work/src/cli/catho-apply-queued.ts
// Aplica em vagas Catho já na fila (status=queued) sem re-escanear a busca.
// Uso: tsx src/cli/catho-apply-queued.ts [--limit 1] [--dry-run] [--headless]

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), override: false });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false });

import { program } from 'commander';
import { LinkedInSession } from '../engine/session.js';
import { CathoSession, CathoApplyEngine } from '../engine/catho.js';
import { ObsidianVaultLoader } from '../rag/vault-loader.js';
import { VaultRetriever } from '../rag/retriever.js';
import { QuestionnaireAgent } from '../agents/QuestionnaireAgent.js';
import { QuestionnaireLogger } from '../agents/QuestionnaireLogger.js';
import { StatusTracker } from '../agents/StatusTracker.js';
import type { CathoJob } from '../types/index.js';

program
  .option('--limit <n>', 'Maximo de aplicacoes', '1')
  .option('--dry-run', 'Simula sem submeter')
  .option('--headless', 'Browser headless')
  .option('--vault <path>', 'Vault Obsidian', process.env.OBSIDIAN_VAULT ?? '')
  .option('--resume <path>', 'PDF do curriculo', process.env.RESUME_PATH ?? '')
  .parse();

const opts = program.opts();

async function main() {
  const limit = parseInt(opts.limit, 10);
  const dryRun = !!opts.dryRun;

  console.log(`\nVRAXIA WORK — Catho Apply Queued${dryRun ? ' (DRY RUN)' : ''}\n`);

  const tracker = await StatusTracker.create();

  // Vagas catho na fila, melhores scores primeiro
  const rows = tracker.listByStatus('queued', 100)
    .filter((r: Record<string, unknown>) => String(r['id']).startsWith('catho_'))
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
      ((b['score_total'] as number) ?? 0) - ((a['score_total'] as number) ?? 0));

  if (!rows.length) {
    console.log('Nenhuma vaga Catho na fila. Rode o hunt primeiro.');
    tracker.close();
    return;
  }

  const queued: { job: CathoJob; score: number }[] = rows.map((r: Record<string, unknown>) => ({
    score: (r['score_total'] as number) ?? 0,
    job: {
      id: String(r['id']),
      cathoJobId: String(r['id']).replace('catho_', ''),
      title: String(r['job_title'] ?? ''),
      company: String(r['company'] ?? ''),
      location: String(r['location'] ?? ''),
      linkedinUrl: String(r['linkedin_url'] ?? ''),
      applicationUrl: String(r['linkedin_url'] ?? ''),
      description: String(r['description'] ?? ''),
      isEasyApply: true,
      scannedAt: String(r['scanned_at'] ?? new Date().toISOString()),
      platform: 'catho',
    },
  }));

  console.log(`${queued.length} vagas Catho na fila:`);
  for (const q of queued.slice(0, 10)) {
    console.log(`  [${q.score}/30] ${q.job.title}`);
  }

  const retriever = new VaultRetriever();
  if (opts.vault) {
    try {
      retriever.index(new ObsidianVaultLoader(opts.vault).load('vraxia-work'));
    } catch (err) {
      console.warn('[Vault] nao carregado — contexto padrao.', err);
    }
  }
  const questionnaire = new QuestionnaireAgent(retriever, process.env.ANTHROPIC_API_KEY, new QuestionnaireLogger());

  const session = new LinkedInSession();
  const page = await session.init({ headless: !!opts.headless });

  const cathoSession = new CathoSession(page);
  if (!await cathoSession.login()) {
    console.error('[Catho] Falha no login.');
    await session.close();
    tracker.close();
    process.exit(1);
  }

  const applyEngine = new CathoApplyEngine(page);
  const resumePath = opts.resume || path.resolve(process.cwd(), 'resume.pdf');
  let applied = 0;

  for (const record of queued) {
    if (applied >= limit) break;
    const job = record.job;
    console.log(`\n→ Aplicando: ${job.title} @ ${job.company} [${record.score}/30]`);
    console.log(`  URL: ${job.applicationUrl}`);

    questionnaire.setJob(job.id, job.title, job.company, job.linkedinUrl);
    tracker.updateStatus(job.id, 'applying');

    try {
      const ok = await applyEngine.apply(job, {
        resumePath,
        dryRun,
        onQuestion: async q => (await questionnaire.answer(q)).answer,
      });

      if (ok && !dryRun) {
        tracker.updateStatus(job.id, 'applied');
        applied++;
        console.log('  ✅ Aplicado!');
      } else if (ok && dryRun) {
        tracker.updateStatus(job.id, 'queued', 'dry-run ok');
        applied++;
        console.log('  ✅ Simulado (mantido na fila).');
      } else {
        tracker.updateStatus(job.id, 'queued', 'apply retornou false — mantido na fila');
        console.log('  ⚠ Não submetido — mantido na fila.');
      }
    } catch (err) {
      tracker.updateStatus(job.id, 'error', String(err));
      console.error('  ✗ Erro:', err);
    }

    if (process.exitCode === 2) {
      console.error('CAPTCHA/ban — abortando.');
      break;
    }
  }

  console.log(`\nResultado: ${applied}/${limit} aplicadas.`);
  await session.close();
  tracker.close();
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
