/**
 * CLI — Classifier Pipeline
 *
 * Lê prospects de um JSON, classifica respostas LinkedIn,
 * gera relatórios de handoff e salva resultados.
 *
 * Uso:
 *   npx tsx scripts/run-classifier-pipeline.ts                     # sample data
 *   npx tsx scripts/run-classifier-pipeline.ts --input leads.json  # arquivo externo
 *   npx tsx scripts/run-classifier-pipeline.ts --dry-run           # sem chamadas à API
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  runClassifierPipeline,
  printPipelineSummary,
  type Prospect,
  type HandoffEntry,
} from '../agents/lead-classifier/pipeline.js';

// processLinkedInReply disponível para uso direto em integrações externas
export { processLinkedInReply } from '../agents/lead-classifier/classifier.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DRY_RUN   = process.argv.includes('--dry-run');
const INPUT_IDX = process.argv.indexOf('--input');
const INPUT_FILE = INPUT_IDX !== -1 ? process.argv[INPUT_IDX + 1] : null;

// ─── Load .env ────────────────────────────────────────────────────────────────

try {
  const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch { /* ignore */ }

// ─── Sample prospects (substitua pelo seu JSON real) ──────────────────────────

const SAMPLE_PROSPECTS: Prospect[] = [
  {
    name:        'Ana Beatriz Costa',
    company:     'Banco Itaú',
    role:        'Gerente de Eventos Corporativos',
    linkedinUrl: 'https://linkedin.com/in/anabeatriz',
    reply:       'Olá! Faz sentido sim. Temos o nosso congresso anual em setembro e estamos avaliando fornecedores. Pode me mandar mais detalhes de como vocês operam?',
  },
  {
    name:        'Carlos Mendes',
    company:     'Claro Brasil',
    role:        'Head de Marketing',
    linkedinUrl: 'https://linkedin.com/in/carlosmendes',
    reply:       'Obrigado pela mensagem. Temos agência parceira que cuida disso. Mas se quiser deixar o contato de vocês, posso guardar.',
  },
  {
    name:        'Fernanda Lima',
    company:     'Magazine Luiza',
    role:        'Diretora de Comunicação',
    linkedinUrl: 'https://linkedin.com/in/fernandalima',
    reply:       'Interessante. Temos eventos internos grandes e alguns somos patrocinadores. Quando você está disponível essa semana para uma ligação rápida?',
  },
  {
    name:        'Roberto Alves',
    company:     'Embraer',
    role:        'Analista de Marketing',
    linkedinUrl: 'https://linkedin.com/in/robertoalves',
    reply:       'Ok, entendido.',
  },
  {
    name:        'Patricia Souza',
    company:     'Hapvida',
    role:        'VP de Pessoas',
    linkedinUrl: 'https://linkedin.com/in/patriciasouza',
    reply:       'Nossa agenda de eventos é feita internamente pelo time de cultura. Não costumamos contratar externos para isso.',
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Load prospects from file or use sample
  let prospects: Prospect[] = SAMPLE_PROSPECTS;

  if (INPUT_FILE) {
    const raw = fs.readFileSync(
      path.isAbsolute(INPUT_FILE) ? INPUT_FILE : path.join(ROOT, INPUT_FILE),
      'utf-8'
    );
    prospects = JSON.parse(raw) as Prospect[];
    console.log(`\n📂 Carregados ${prospects.length} prospects de ${INPUT_FILE}`);
  } else {
    console.log(`\n📋 Usando ${prospects.length} prospects de amostra`);
  }

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Listando prospects sem chamar a API:\n');
    prospects.forEach((p, i) =>
      console.log(`  ${i + 1}. ${p.name} (${p.company}) — "${p.reply.slice(0, 60)}..."`)
    );
    return;
  }

  console.log('\n🚀 Iniciando classificação...\n');

  const result = await runClassifierPipeline(prospects, {
    delayMs: 300,

    onProgress: (i, total, prospect, classification) => {
      const icon = classification.handoff ? '🔔' : classification.intent === 'none' ? '⛔' : '✓';
      console.log(
        `  [${i}/${total}] ${icon} ${prospect.name.padEnd(22)} ` +
        `V:${classification.variant} · ${classification.intent.toUpperCase()}`
      );
    },

    onHandoff: (entry: HandoffEntry) => {
      console.log('\n' + entry.report + '\n');
    },
  });

  // Print summary table
  printPipelineSummary(result);

  // Save full results
  const today    = new Date().toISOString().split('T')[0];
  const outDir   = path.join(ROOT, 'vault', 'imprensa', 'logs');
  const outPath  = path.join(outDir, `classifier_${today}.json`);
  const hdPath   = path.join(outDir, `handoffs_${today}.txt`);

  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`📁 Resultados completos → ${outPath}`);

  if (result.handoffs.length > 0) {
    const hdText = result.handoffs.map(h => h.report).join('\n\n' + '═'.repeat(50) + '\n\n');
    fs.writeFileSync(hdPath, hdText, 'utf-8');
    console.log(`🔔 Relatórios de handoff → ${hdPath}\n`);
  }
}

main().catch(err => {
  console.error('[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
