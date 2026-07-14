// packages/work/src/application/ApplicationTruthEngine.ts
// Evidence-based verification: reads artifacts from the evidence directory
// and produces a TruthRecord with TruthStatus and ranked proofs.
//
// Public stub — exact proof weights and classification thresholds are defined
// in the private build. See ADR-002 for the architectural rationale.
//
// TruthStatus is independent of ApplicationState:
//   ApplicationState.confirmed — the workflow completed successfully.
//   TruthStatus.VERIFIED       — physical evidence confirms submission.
// These two values can diverge; the dashboard surfaces both as separate columns.

import fs from 'fs';
import path from 'path';
import {
  TruthStatus,
  ProofType,
  ApplicationProof,
  TruthRecord,
  ValidationResult,
  ApplicationState,
  EvidenceManifest,
  NetworkRequest,
} from './types.js';

// Hard proof types: any single one is sufficient to reach VERIFIED.
// Exact scoring weights and thresholds defined in private implementation (ADR-002).
const HARD_PROOFS: ProofType[] = ['network_submit_200', 'my_jobs_applied', 'ats_confirmation'];

export class ApplicationTruthEngine {
  /**
   * Evaluates evidence for a single application. Called by ApplicationService
   * after ValidationEngine, or post-hoc from any evidence directory.
   */
  evaluate(opts: {
    jobId: string;
    traceId: string;
    evidenceDir: string;
    finalState: ApplicationState;
    validationResult?: ValidationResult;
    healthScore?: number;
  }): TruthRecord {
    const proofs: ApplicationProof[] = [];
    const now = new Date().toISOString();

    // ── Proof 1: existing ValidationResult ────────────────────────────────
    if (opts.validationResult?.confirmed) {
      const proofType = this.mapValidationMethod(opts.validationResult.method);
      if (proofType) {
        proofs.push({
          type: proofType,
          weight: this.proofScore(proofType),
          description: opts.validationResult.details,
          evidence: opts.validationResult.evidence ?? {},
          timestamp: now,
        });
      }
    }

    // ── Proof 2: network.json — trusts isApplicationRelated set by private engine ──
    const networkFile = path.join(opts.evidenceDir, 'network.json');
    if (fs.existsSync(networkFile)) {
      try {
        const net = JSON.parse(fs.readFileSync(networkFile, 'utf-8')) as NetworkRequest[];
        const hit = net.find(r =>
          r.isApplicationRelated &&
          r.method === 'POST' &&
          r.status >= 200 && r.status < 300
        );
        if (hit && !proofs.some(p => p.type === 'network_submit_200')) {
          proofs.push({
            type: 'network_submit_200',
            weight: this.proofScore('network_submit_200'),
            description: `POST ${hit.url.slice(0, 80)} → HTTP ${hit.status}`,
            evidence: { url: hit.url, status: hit.status },
            timestamp: hit.timestamp ?? now,
          });
        }
      } catch { /* corrupt network.json — skip */ }
    }

    // ── Proof 3: manifest (screenshot evidence) ────────────────────────────
    const manifestFile = path.join(opts.evidenceDir, 'manifest.json');
    if (fs.existsSync(manifestFile)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8')) as EvidenceManifest;
        if (manifest.screenshots.length > 0) {
          proofs.push({
            type: 'screenshot_exists',
            weight: this.proofScore('screenshot_exists'),
            description: `${manifest.screenshots.length} screenshot(s) captured`,
            evidence: { count: manifest.screenshots.length },
            timestamp: manifest.finishedAt ?? now,
          });
        }
      } catch { /* corrupt manifest — skip */ }
    }

    // ── Proof 4: trace.json with submit event ─────────────────────────────
    const traceFile = path.join(opts.evidenceDir, 'trace.json');
    if (fs.existsSync(traceFile)) {
      try {
        const trace = JSON.parse(fs.readFileSync(traceFile, 'utf-8')) as {
          events?: Array<{ step: string; result: string }>;
        };
        const hasSubmit = (trace.events ?? []).some(e =>
          (e.step.includes('submit') || e.step.includes('submitted')) && e.result !== 'error'
        );
        if (hasSubmit) {
          proofs.push({
            type: 'trace_complete',
            weight: this.proofScore('trace_complete'),
            description: 'trace.json contains successful submit event',
            evidence: {},
            timestamp: now,
          });
        }
      } catch { /* corrupt trace — skip */ }
    }

    // ── Proof 5: health report ────────────────────────────────────────────
    const healthFile = path.join(opts.evidenceDir, 'health-report.json');
    if (fs.existsSync(healthFile)) {
      try {
        const health = JSON.parse(fs.readFileSync(healthFile, 'utf-8')) as { score?: number };
        if ((health.score ?? 0) >= 80) {
          proofs.push({
            type: 'health_check_passed',
            weight: this.proofScore('health_check_passed'),
            description: `Health check score: ${health.score}/100`,
            evidence: { score: health.score },
            timestamp: now,
          });
        }
      } catch { /* corrupt health report — skip */ }
    } else if (opts.healthScore !== undefined && opts.healthScore >= 80) {
      proofs.push({
        type: 'health_check_passed',
        weight: this.proofScore('health_check_passed'),
        description: `Health check score: ${opts.healthScore}/100`,
        evidence: { score: opts.healthScore },
        timestamp: now,
      });
    }

    // ── Score and TruthStatus ─────────────────────────────────────────────
    const validationScore = Math.min(100, proofs.reduce((sum, p) => sum + p.weight, 0));
    const hasHardProof = proofs.some(p => HARD_PROOFS.includes(p.type));
    const confidence = this.classify(hasHardProof, proofs, opts.finalState);
    const primaryProof = proofs.slice().sort((a, b) => b.weight - a.weight)[0];

    const record: TruthRecord = {
      jobId:          opts.jobId,
      traceId:        opts.traceId,
      evaluatedAt:    now,
      confidence,
      validationScore,
      proofs,
      primaryProof,
      evidenceDir:    opts.evidenceDir,
      summary:        this.buildSummary(confidence, proofs, opts.finalState),
    };

    // Write truth-record.json into the evidence directory for post-hoc access
    try {
      if (fs.existsSync(opts.evidenceDir)) {
        fs.writeFileSync(
          path.join(opts.evidenceDir, 'truth-record.json'),
          JSON.stringify(record, null, 2),
          'utf-8',
        );
      }
    } catch { /* do not block caller */ }

    return record;
  }

  /** Reads evidence from an existing directory (post-hoc, no ValidationResult). */
  evaluateFromDir(jobId: string, evidenceDir: string, finalState: ApplicationState = 'failed'): TruthRecord {
    return this.evaluate({
      jobId,
      traceId: `posthoc_${Date.now()}`,
      evidenceDir,
      finalState,
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private mapValidationMethod(method: string): ProofType | null {
    switch (method) {
      case 'network_response':  return 'network_submit_200';
      case 'my_jobs_applied':   return 'my_jobs_applied';
      case 'page_transition':   return 'url_redirect';
      case 'confirmation_text': return 'confirmation_text';
      default:                  return null;
    }
  }

  // Categorical scoring: hard proofs > medium proofs > weak proofs.
  // Exact values are defined in the private implementation (ADR-002).
  private proofScore(type: ProofType): number {
    if (HARD_PROOFS.includes(type)) return 80;
    if (type === 'confirmation_text' || type === 'url_redirect') return 50;
    return 15;
  }

  private classify(
    hasHardProof: boolean,
    proofs: ApplicationProof[],
    finalState: ApplicationState,
  ): TruthStatus {
    if (hasHardProof) return 'VERIFIED';
    if (proofs.some(p => p.type === 'confirmation_text' || p.type === 'url_redirect')) return 'PROBABLE';
    // Confirmed workflow + any positive evidence: workflow corroborates the proof
    if (finalState === 'confirmed' && proofs.length > 0) return 'PROBABLE';
    if (['failed', 'cancelled', 'blocked', 'timeout'].includes(finalState)) return 'REJECTED';
    return 'UNKNOWN';
  }

  private buildSummary(
    confidence: TruthStatus,
    proofs: ApplicationProof[],
    finalState: ApplicationState,
  ): string {
    const proofNames = proofs.map(p => p.type).join(' + ');
    switch (confidence) {
      case 'VERIFIED':
        return `VERIFIED — objective evidence confirms submission. Proofs: [${proofNames}]`;
      case 'PROBABLE':
        return `PROBABLE — partial evidence. Proofs: [${proofNames}]. Final state: ${finalState}`;
      case 'REJECTED':
        return `REJECTED — no submission evidence found. Final state: ${finalState}`;
      case 'EXPIRED':
        return `EXPIRED — evidence no longer accessible. Final state: ${finalState}`;
      default:
        return `UNKNOWN — insufficient evidence. Final state: ${finalState}`;
    }
  }
}
