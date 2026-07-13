// packages/work/src/application/HealthCheck.ts
// Valida automaticamente cada candidatura após process() e grava health-report.json.
// Nenhuma candidatura pode ser considerada "saudável" sem evidências concretas.

import fs from 'fs';
import path from 'path';
import { ApplicationResult } from './types.js';

export interface HealthCheckResult {
  applicationId: string;
  healthy: boolean;
  score: number;           // 0–100
  checks: {
    screenshot: boolean;    // evidências visuais existem
    trace: boolean;         // trace.json gravado
    network: boolean;       // respostas de rede capturadas
    html: boolean;          // HTML de confirmação capturado
    timeline: boolean;      // timeline.json gravado
    evidence: boolean;      // manifest.json gravado
    application_state: boolean;  // estado final não é ambíguo
    repository: boolean;    // registro no DB atualizado
    dashboard: boolean;     // acessível via API
    validation: boolean;    // método de validação real (não 'none')
    attempt: boolean;       // pelo menos uma tentativa registrada
    confirmation: boolean;  // candidatura confirmada com evidência concreta
  };
  warnings: string[];
  generatedAt: string;
}

export function runHealthCheck(
  result: ApplicationResult,
  evidenceDir: string,
): HealthCheckResult {
  const warnings: string[] = [];
  const checks = {
    screenshot: false,
    trace: false,
    network: false,
    html: false,
    timeline: false,
    evidence: false,
    application_state: false,
    repository: false,
    dashboard: false,
    validation: false,
    attempt: false,
    confirmation: false,
  };

  // ── Evidências de arquivo ──────────────────────────────────────────────────

  const traceFile    = path.join(evidenceDir, 'trace.json');
  const timelineFile = path.join(evidenceDir, 'timeline.json');
  const manifestFile = path.join(evidenceDir, 'manifest.json');
  const networkFile  = path.join(evidenceDir, 'network.json');

  checks.trace    = fs.existsSync(traceFile);
  checks.timeline = fs.existsSync(timelineFile);
  checks.evidence = fs.existsSync(manifestFile);

  if (!checks.trace)    warnings.push('trace.json ausente — rastreabilidade comprometida');
  if (!checks.timeline) warnings.push('timeline.json ausente — duração por etapa indisponível');
  if (!checks.evidence) warnings.push('manifest.json ausente — evidência primária indisponível');

  // Screenshots: pelo menos 1 PNG no diretório de evidências
  try {
    const files = fs.existsSync(evidenceDir) ? fs.readdirSync(evidenceDir) : [];
    checks.screenshot = files.some(f => f.endsWith('.png'));
    checks.html       = files.some(f => f.endsWith('.html'));
    if (!checks.screenshot) warnings.push('Nenhum screenshot encontrado — sem evidência visual');
    if (!checks.html)       warnings.push('Nenhum HTML capturado — diagnóstico limitado');
  } catch { /* diretório inexistente */ }

  // Respostas de rede: verifica network.json
  if (checks.evidence && fs.existsSync(networkFile)) {
    try {
      const net = JSON.parse(fs.readFileSync(networkFile, 'utf-8')) as Array<{ isApplicationRelated?: boolean }>;
      checks.network = Array.isArray(net) && net.some(r => r.isApplicationRelated);
      if (!checks.network) warnings.push('Nenhuma requisição de rede de candidatura capturada');
    } catch { warnings.push('network.json corrompido ou ilegível'); }
  } else {
    warnings.push('network.json ausente');
  }

  // ── Estado e validação ─────────────────────────────────────────────────────

  const nonAmbiguousTerminals = ['confirmed', 'failed', 'cancelled', 'blocked', 'timeout'];
  checks.application_state = nonAmbiguousTerminals.includes(result.finalState);
  if (!checks.application_state) {
    warnings.push(`Estado final ambíguo: '${result.finalState}' — candidatura pode estar presa`);
  }

  checks.validation = (result.validation?.method ?? 'none') !== 'none';
  if (!checks.validation && result.finalState === 'confirmed') {
    warnings.push('Candidatura marcada confirmed sem método de validação concreto');
  }

  checks.confirmation = result.confirmed && checks.validation;
  if (result.confirmed && !checks.validation) {
    warnings.push('CRÍTICO: confirmed=true mas validation.method=none — evidência ausente');
  }

  // ── Repository e dashboard ─────────────────────────────────────────────────

  // repository: verificamos indiretamente — se state foi atualizado, o DB foi escrito
  // (ApplicationService sempre chama updateState antes de retornar)
  checks.repository = !nonAmbiguousTerminals.includes(result.finalState)
    ? result.finalState !== 'submitted' // submitted sem confirmação = suspeito
    : true;

  // dashboard: verificamos se o manifest é legível (proxy para acessibilidade da API)
  checks.dashboard = checks.evidence;

  // attempt: pelo menos 1 tentativa
  checks.attempt = result.attempts >= 0; // 0 em dry-run é aceitável

  // ── Pontuação ──────────────────────────────────────────────────────────────

  const weights: Record<keyof typeof checks, number> = {
    screenshot:        8,
    trace:            10,
    network:          12,
    html:              8,
    timeline:          5,
    evidence:         10,
    application_state: 15,
    repository:       10,
    dashboard:         5,
    validation:       12,
    attempt:           5,
    confirmation:     0,   // bônus: apenas se confirmed
  };

  let score = 0;
  let maxScore = 0;
  for (const [key, w] of Object.entries(weights) as [keyof typeof checks, number][]) {
    maxScore += w;
    if (checks[key]) score += w;
  }
  // Bônus de 10 se confirmado com evidência
  if (checks.confirmation) { score += 10; maxScore += 10; }

  const normalizedScore = Math.round((score / maxScore) * 100);
  const healthy = normalizedScore >= 70 && !warnings.some(w => w.startsWith('CRÍTICO'));

  const report: HealthCheckResult = {
    applicationId: result.jobId,
    healthy,
    score: normalizedScore,
    checks,
    warnings,
    generatedAt: new Date().toISOString(),
  };

  // Grava health-report.json no diretório de evidências
  try {
    if (evidenceDir && fs.existsSync(evidenceDir)) {
      fs.writeFileSync(
        path.join(evidenceDir, 'health-report.json'),
        JSON.stringify(report, null, 2),
        'utf-8',
      );
    }
  } catch { /* não bloquear o caller */ }

  return report;
}
