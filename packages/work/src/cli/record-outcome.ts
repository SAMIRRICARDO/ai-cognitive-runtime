// packages/work/src/cli/record-outcome.ts
// Registra resultado real de uma candidatura → alimenta LearningEngine para calibração futura.
//
// Uso:
//   tsx src/cli/record-outcome.ts --list
//   tsx src/cli/record-outcome.ts --job-id <id> --outcome interview
//   tsx src/cli/record-outcome.ts --job-id <id> --outcome rejection --response-days 5

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { program } from 'commander';
import { ProfessionalTwinsStore } from '../twin/professional-twins.js';
import { LearningEngine } from '../engine/learning-engine.js';
import type { InterviewOutcomeType } from '../types/hire-intelligence.js';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), override: false });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false });

const VALID_OUTCOMES: InterviewOutcomeType[] = [
  'interview', 'rejection', 'no_response', 'offer', 'hired', 'ghosted',
];

program
  .option('--job-id <id>', 'ID da candidatura (pode ser prefixo)')
  .option('--outcome <type>', `Resultado: ${VALID_OUTCOMES.join(' | ')}`)
  .option('--response-days <n>', 'Dias corridos até a resposta')
  .option('--list', 'Lista as últimas candidaturas submetidas (action=APPLY)')
  .parse();

const opts = program.opts<{
  jobId?: string;
  outcome?: string;
  responseDays?: string;
  list?: boolean;
}>();

const DECISIONS_FILE = path.resolve(process.cwd(), '.vraxia-work', 'decisions.jsonl');

type DecisionRecord = {
  timestamp: string;
  jobId: string;
  jobTitle: string;
  company: string;
  platform?: string;
  twinId: string;
  twinLabel: string;
  hireScore: number;
  interviewProbability: number;
  action: string;
  dimensions?: { technicalFit: number; atsProbability: number };
  atsKeywordsFound?: string[];
  atsKeywordsMissing?: string[];
};

function loadDecisions(): DecisionRecord[] {
  if (!fs.existsSync(DECISIONS_FILE)) return [];
  return fs.readFileSync(DECISIONS_FILE, 'utf-8')
    .trim().split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l) as DecisionRecord; } catch { return null; } })
    .filter(Boolean) as DecisionRecord[];
}

async function main(): Promise<void> {
  const all = loadDecisions();

  // ── Modo lista ──────────────────────────────────────────────────────────────
  if (opts.list || !opts.jobId) {
    if (!all.length) {
      console.log('\nNenhuma decisão registrada ainda. Execute hunt primeiro.\n');
      return;
    }
    const applied = all.filter(d => d.action === 'APPLY').slice(-25);
    console.log('\nÚltimas candidaturas (APPLY):\n');
    for (const d of applied) {
      const date = new Date(d.timestamp).toLocaleDateString('pt-BR');
      const shortId = d.jobId.slice(0, 10);
      console.log(
        `  ${shortId}  ${d.jobTitle.slice(0, 35).padEnd(35)}  ` +
        `${d.company.slice(0, 25).padEnd(25)}  ` +
        `${d.twinLabel.padEnd(16)}  HS:${String(d.hireScore).padStart(3)}  IP:${String(d.interviewProbability).padStart(3)}%  ${date}`,
      );
    }
    console.log(`\nUse --job-id <id> --outcome <resultado> para registrar.\n`);
    return;
  }

  // ── Validação ───────────────────────────────────────────────────────────────
  if (!opts.outcome || !VALID_OUTCOMES.includes(opts.outcome as InterviewOutcomeType)) {
    console.error(`\nOutcome inválido. Use: ${VALID_OUTCOMES.join(' | ')}\n`);
    process.exit(1);
  }

  const record = all.find(d => d.jobId === opts.jobId || d.jobId.startsWith(opts.jobId!));
  if (!record) {
    console.error(`\nCandidatura não encontrada: ${opts.jobId}`);
    console.log('Use --list para ver os IDs disponíveis.\n');
    process.exit(1);
  }

  // ── Registra no LearningEngine ──────────────────────────────────────────────
  const twinsStore = await ProfessionalTwinsStore.create();
  const engine     = new LearningEngine(twinsStore);

  const outcome = opts.outcome as InterviewOutcomeType;
  const responseTimeDays = opts.responseDays ? parseInt(opts.responseDays, 10) : undefined;

  engine.recordOutcome({
    jobId:                    record.jobId,
    twinId:                   record.twinId as Parameters<typeof engine.recordOutcome>[0]['twinId'],
    company:                  record.company,
    jobTitle:                 record.jobTitle,
    platform:                 record.platform ?? 'linkedin',
    stackTags:                record.atsKeywordsFound ?? [],
    outcome,
    hireScoreAtApply:         record.hireScore,
    interviewProbabilityAtApply: record.interviewProbability,
    technicalFitAtApply:      record.dimensions?.technicalFit ?? 0,
    atsProbabilityAtApply:    record.dimensions?.atsProbability ?? 0,
    responseTimeDays,
  });

  console.log(`\n✅ Resultado registrado:`);
  console.log(`   ${record.jobTitle} @ ${record.company}`);
  console.log(`   Twin: ${record.twinLabel} | HS: ${record.hireScore} | IP: ${record.interviewProbability}%`);
  console.log(`   Outcome: ${outcome}${responseTimeDays !== undefined ? ` (${responseTimeDays}d)` : ''}`);

  // Mostra o interview rate atualizado para este twin
  const insights  = engine.getInsightsSummary();
  const twinPat   = insights.topTwins.find(t => t.patternKey === record.twinId);
  if (twinPat && twinPat.totalApplications >= 1) {
    const ir = Math.round(twinPat.interviewRate * 100);
    console.log(`\n   Interview Rate acumulado — ${record.twinId}: ${ir}% (${twinPat.interviews}/${twinPat.totalApplications})`);
  }
  const overall = Math.round(insights.overallInterviewRate * 100);
  if (overall > 0) console.log(`   Interview Rate geral: ${overall}%`);

  console.log('');
  twinsStore.close();
}

main().catch(err => { console.error('\nErro:', err); process.exit(1); });
