// scripts/recover-evidence-to-db.ts
// Recovers jobs from evidence dirs that were lost due to CareerMemory clobbering work.db.
// Safe to run multiple times — uses INSERT OR IGNORE to avoid duplicates.

import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

const WORK_DIR    = path.resolve(process.cwd(), '.vraxia-work');
const DB_PATH     = path.join(WORK_DIR, 'work.db');
const LOGS_DIR    = path.join(WORK_DIR, 'logs');

interface TruthRecord {
  jobId: string;
  traceId: string;
  evaluatedAt: string;
  confidence: 'CONFIRMED' | 'PROBABLE' | 'FAILED' | 'UNKNOWN';
  validationScore: number;
  proofs: Array<{ type: string; weight: number; description: string; evidence?: string; timestamp: string }>;
  summary: string;
}

interface Manifest {
  jobId: string;
  company: string;
  jobTitle: string;
  platform: string;
  startedAt: string;
  finishedAt: string;
  finalState: string;
}

async function main() {
  const SQL  = await initSqlJs();
  const buf  = fs.readFileSync(DB_PATH);
  const db   = new SQL.Database(buf);

  const evidenceDirs = fs.readdirSync(LOGS_DIR)
    .filter(d => d.startsWith('application_'))
    .map(d => ({ name: d, jobId: d.replace('application_', ''), dir: path.join(LOGS_DIR, d) }));

  let recovered = 0;
  let skipped   = 0;
  let errors    = 0;

  for (const { jobId, dir } of evidenceDirs) {
    // Check if already in DB
    const exists = db.exec(`SELECT id FROM job_applications WHERE id = '${jobId}'`);
    if (exists.length && exists[0].values.length) {
      // Already in DB — just update truth data if missing
      const truthRow = db.exec(`SELECT confidence FROM job_applications WHERE id = '${jobId}'`);
      const conf = truthRow[0]?.values[0]?.[0] as string;
      if (conf && conf !== 'UNKNOWN') { skipped++; continue; }

      const truthPath = path.join(dir, 'truth-record.json');
      if (fs.existsSync(truthPath)) {
        try {
          const truth: TruthRecord = JSON.parse(fs.readFileSync(truthPath, 'utf-8'));
          db.run(
            `UPDATE job_applications SET confidence=?, validation_score=?, proofs_json=?, evidence_dir=?, updated_at=? WHERE id=?`,
            [truth.confidence, truth.validationScore, JSON.stringify(truth.proofs), dir, new Date().toISOString(), jobId]
          );
          console.log(`  Updated truth for ${jobId}: ${truth.confidence} (${truth.validationScore})`);
          recovered++;
        } catch { errors++; }
      } else {
        skipped++;
      }
      continue;
    }

    // Not in DB — reconstruct minimal row from manifest + truth-record
    const manifestPath  = path.join(dir, 'manifest.json');
    const truthPath     = path.join(dir, 'truth-record.json');

    if (!fs.existsSync(manifestPath)) { errors++; continue; }

    try {
      const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const truth: TruthRecord | null = fs.existsSync(truthPath)
        ? JSON.parse(fs.readFileSync(truthPath, 'utf-8'))
        : null;

      const linkedinUrl = `https://www.linkedin.com/jobs/view/${jobId}/`;
      const stateToStatus: Record<string, string> = {
        confirmed: 'applied', failed: 'error', cancelled: 'filtered_out',
        submitted: 'applied', rejected: 'filtered_out', timeout: 'error',
      };
      const status = stateToStatus[manifest.finalState] ?? 'error';

      const now = new Date().toISOString();
      db.run(`
        INSERT OR IGNORE INTO job_applications (
          id, job_title, company, location, linkedin_url,
          status, application_state, score_total, score_action,
          evidence_dir, confidence, validation_score, proofs_json,
          updated_at, scanned_at, applied_at, platform
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        jobId,
        manifest.jobTitle,
        manifest.company,
        null,
        linkedinUrl,
        status,
        manifest.finalState,
        0,
        'APPLY',
        dir,
        truth?.confidence ?? 'UNKNOWN',
        truth?.validationScore ?? 0,
        truth ? JSON.stringify(truth.proofs) : null,
        now,
        manifest.startedAt,
        status === 'applied' ? manifest.finishedAt : null,
        manifest.platform ?? 'linkedin',
      ]);

      console.log(`  Recovered: ${jobId} (${manifest.jobTitle} @ ${manifest.company}) → ${status} | ${truth?.confidence ?? 'UNKNOWN'}`);
      recovered++;
    } catch (err) {
      console.error(`  ERROR for ${jobId}:`, err);
      errors++;
    }
  }

  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  db.close();

  console.log(`\nRecovery complete: ${recovered} recovered, ${skipped} skipped (already OK), ${errors} errors`);
}

main().catch(err => { console.error(err); process.exit(1); });
