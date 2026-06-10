import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadKey(): string {
  try {
    const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
    for (const line of env.split(/\r?\n/)) {
      const m = line.match(/^RESEND_API_KEY\s*=\s*(.+)$/);
      if (m) return m[1].trim();
    }
  } catch { /* ignore */ }
  return '';
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface LogEntry {
  email: string; veiculo: string; subject: string;
  resend_id: string; status: string; sent_at: string;
  delivery_status?: string;
}

async function main() {
  const resend  = new Resend(loadKey());
  const logsDir = path.join(ROOT, 'vault/imprensa/logs');
  const today   = new Date().toISOString().split('T')[0];

  // Collect all log files from today
  const logFiles = fs.readdirSync(logsDir)
    .filter(f => f.endsWith('.json') && f.includes(today) && !f.startsWith('linkedin') && !f.startsWith('debug'));

  const allEntries: LogEntry[] = [];
  for (const f of logFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(logsDir, f), 'utf-8'));
    if (Array.isArray(data)) allEntries.push(...data);
  }

  // Also include CTO dispatch (no resend_id saved — sent via inline script)
  // For press contacts from contatos_validados.json
  const contatos = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'dados_imprensa_linkedin/contatos_validados.json'), 'utf-8')
  );
  for (const c of contatos) {
    if (c.status === 'enviado' && c.sent_at?.startsWith(today)) {
      allEntries.push({
        email: c.email_validado, veiculo: c.veiculo,
        subject: `(template ${c.template_recomendado})`,
        resend_id: '', status: 'sent', sent_at: c.sent_at,
      });
    }
  }

  console.log(`\n[RELATÓRIO] ${allEntries.length} emails despachados hoje (${today})\n`);
  console.log('Consultando status no Resend...\n');

  const report: Array<{
    veiculo: string; email: string; subject: string;
    enviado_em: string; delivery: string; resend_id: string;
  }> = [];

  for (const entry of allEntries) {
    let delivery = entry.status.startsWith('error') ? `❌ ERRO: ${entry.status}` : '✅ enviado';

    if (entry.resend_id) {
      try {
        const { data } = await resend.emails.get(entry.resend_id);
        const last: string = (data as any)?.last_event ?? 'unknown';
        const statusMap: Record<string, string> = {
          sent:        '📤 enviado',
          delivered:   '✅ entregue',
          opened:      '👁️  aberto',
          clicked:     '🔗 clicado',
          bounced:     '🔴 bounced (email inválido/inexistente)',
          complained:  '⚠️  spam report',
          unsubscribed:'🚫 unsubscribed',
        };
        delivery = statusMap[last] ?? `ℹ️  ${last}`;
      } catch { delivery = '⚠️  não consultado'; }
      await sleep(200); // rate limit
    }

    report.push({
      veiculo:    entry.veiculo,
      email:      entry.email,
      subject:    entry.subject.slice(0, 60),
      enviado_em: entry.sent_at?.slice(11, 19) + ' BRT',
      delivery,
      resend_id:  entry.resend_id || '(sem id)',
    });
  }

  // Print table
  const col = (s: string, w: number) => s.slice(0, w).padEnd(w);
  console.log(
    col('Veículo', 28) + col('Email', 38) +
    col('Horário', 12) + 'Status'
  );
  console.log('─'.repeat(110));
  for (const r of report) {
    console.log(
      col(r.veiculo, 28) + col(r.email, 38) +
      col(r.enviado_em, 12) + r.delivery
    );
  }

  // Save report
  const reportPath = path.join(logsDir, `report_${today}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n[RESUMO]`);
  console.log(`  Total enviados : ${report.filter(r => !r.delivery.includes('ERRO')).length}`);
  console.log(`  Erros          : ${report.filter(r => r.delivery.includes('ERRO')).length}`);
  console.log(`  Entregues      : ${report.filter(r => r.delivery.includes('entregue')).length}`);
  console.log(`  Bounced        : ${report.filter(r => r.delivery.includes('bounced')).length}`);
  console.log(`  Relatório JSON : ${reportPath}\n`);
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
