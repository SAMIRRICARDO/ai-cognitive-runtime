/**
 * LeadClassifier Pipeline — qualificação + handoff em lote.
 *
 * Fluxo:
 *   prospects[] → classify() → filter handoff → generateHandoffReport()
 *               → PipelineResult { classified, handoffs, reports, summary }
 *
 * Uso:
 *   const result = await runClassifierPipeline(prospects, { delayMs: 300 });
 *   result.reports.forEach(r => console.log(r.report));
 */

import { logger } from '../../config/logger.js';
import { classifyLeadResponse, generateHandoffReport } from './classifier.js';
import type { ClassificationResult, ClassifiedLead } from './types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Prospect {
  name:        string;
  company:     string;
  role:        string;
  linkedinUrl: string;
  reply:       string;
}

export interface HandoffEntry {
  prospect:       Prospect;
  classification: ClassificationResult;
  report:         string;
}

export interface PipelineResult {
  classified: Array<{ prospect: Prospect; classification: ClassificationResult; latency_ms: number }>;
  handoffs:   HandoffEntry[];
  summary:    PipelineSummary;
  ran_at:     string;
}

export interface PipelineSummary {
  total:        number;
  handoffs:     number;
  byIntent:     Record<string, number>;
  byVariant:    Record<string, number>;
  avgLatencyMs: number;
  errors:       number;
}

export interface PipelineOptions {
  /** Intervalo entre chamadas em ms (default: 300) */
  delayMs?: number;
  /** Callback de progresso por prospect */
  onProgress?: (index: number, total: number, prospect: Prospect, result: ClassificationResult) => void;
  /** Callback chamado a cada handoff detectado */
  onHandoff?: (entry: HandoffEntry) => void;
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export async function runClassifierPipeline(
  prospects: Prospect[],
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  const { delayMs = 300, onProgress, onHandoff } = options;
  const startTime = Date.now();

  const classified: PipelineResult['classified'] = [];
  const handoffs: HandoffEntry[] = [];
  const byIntent:  Record<string, number> = {};
  const byVariant: Record<string, number> = {};
  let totalLatency = 0;
  let errors = 0;

  logger.info('[classifier-pipeline] iniciando', { total: prospects.length });

  for (let i = 0; i < prospects.length; i++) {
    const prospect = prospects[i];
    const t0 = Date.now();

    let classification: ClassificationResult;

    try {
      classification = await classifyLeadResponse(prospect.reply, {
        name:    prospect.name,
        company: prospect.company,
        role:    prospect.role,
      });
    } catch (err) {
      logger.error('[classifier-pipeline] erro ao classificar', {
        prospect: prospect.name,
        error: err instanceof Error ? err.message : String(err),
      });
      errors++;
      continue;
    }

    const latency_ms = Date.now() - t0;
    totalLatency += latency_ms;

    // Accumulate stats
    byIntent[classification.intent]   = (byIntent[classification.intent]   ?? 0) + 1;
    byVariant[classification.variant] = (byVariant[classification.variant] ?? 0) + 1;

    classified.push({ prospect, classification, latency_ms });

    logger.info('[classifier-pipeline] classificado', {
      name:     prospect.name,
      variant:  classification.variant,
      intent:   classification.intent,
      handoff:  classification.handoff,
      latency:  latency_ms,
    });

    onProgress?.(i + 1, prospects.length, prospect, classification);

    // Generate handoff report if flagged
    if (classification.handoff) {
      const report = await generateHandoffReport(
        {
          name:          prospect.name,
          company:       prospect.company,
          role:          prospect.role,
          linkedinUrl:   prospect.linkedinUrl,
          originalReply: prospect.reply,
        },
        classification
      );

      const entry: HandoffEntry = { prospect, classification, report };
      handoffs.push(entry);
      onHandoff?.(entry);

      logger.info('[classifier-pipeline] handoff gerado', { name: prospect.name });
    }

    // Rate-limit guard
    if (i < prospects.length - 1 && delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  const summary: PipelineSummary = {
    total:        prospects.length,
    handoffs:     handoffs.length,
    byIntent,
    byVariant,
    avgLatencyMs: classified.length > 0 ? Math.round(totalLatency / classified.length) : 0,
    errors,
  };

  logger.info('[classifier-pipeline] concluído', {
    ...summary,
    duration_ms: Date.now() - startTime,
  });

  return {
    classified,
    handoffs,
    summary,
    ran_at: new Date().toISOString(),
  };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

export function printPipelineSummary(result: PipelineResult): void {
  const { summary } = result;
  const line = '━'.repeat(50);

  console.log(`\n${line}`);
  console.log('  CLASSIFIER PIPELINE — RESUMO');
  console.log(line);
  console.log(`  Total processados : ${summary.total}`);
  console.log(`  Handoffs gerados  : ${summary.handoffs}`);
  console.log(`  Erros             : ${summary.errors}`);
  console.log(`  Latência média    : ${summary.avgLatencyMs}ms`);
  console.log();
  console.log('  Por Intent:');
  Object.entries(summary.byIntent).sort().forEach(([k, v]) =>
    console.log(`    ${k.padEnd(8)} → ${v}`)
  );
  console.log();
  console.log('  Por Variante:');
  Object.entries(summary.byVariant).sort().forEach(([k, v]) =>
    console.log(`    Variante ${k}  → ${v}`)
  );

  if (result.handoffs.length > 0) {
    console.log(`\n  🔔 Handoffs (${result.handoffs.length}):`);
    result.handoffs.forEach(h =>
      console.log(`    → ${h.prospect.name} (${h.prospect.company}) · ${h.classification.intent.toUpperCase()}`)
    );
  }

  console.log(`\n${line}\n`);
}
