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

function removeFM(c: string): string {
  if (c.trimStart().startsWith('---')) {
    const e = c.indexOf('---', c.indexOf('---') + 3);
    if (e !== -1) return c.slice(e + 3).trimStart();
  }
  return c;
}

function parseML(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  let key = '', lines: string[] = [];
  for (const line of removeFM(content).split('\n')) {
    const m = line.match(/^([A-Z_]+):$/);
    if (m) { if (key) result[key] = lines.join('\n').trim(); key = m[1]; lines = []; }
    else if (key) lines.push(line);
  }
  if (key) result[key] = lines.join('\n').trim();
  return result;
}

function parseInline(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of removeFM(content).split('\n')) {
    const m = line.match(/^([A-Z_]+):\s+(.+)$/);
    if (m) result[m[1]] = m[2].trim();
  }
  return result;
}

function applyVars(text: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v), text
  );
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface Target { email: string; nome: string; veiculo: string; tpl: string; }

const BATCH1_EXTRA: Target[] = [
  { email: 'joao.rosa@valor.com.br',               nome: 'Joao',      veiculo: 'Valor Econômico',   tpl: 'A' },
  { email: 'alexandre.roldao@mittechreview.com.br', nome: 'Alexandre', veiculo: 'MIT Tech Review',  tpl: 'B' },
  { email: 'redacao@canaltech.com.br',              nome: 'Equipe',    veiculo: 'Canaltech',         tpl: 'B' },
  { email: 'imprensa@tecnoblog.net',                nome: 'Equipe',    veiculo: 'Tecnoblog',         tpl: 'B' },
  { email: 'redacao@startups.com.br',               nome: 'Equipe',    veiculo: 'Startups.com.br',   tpl: 'A' },
  { email: 'contato@administradores.com.br',        nome: 'Equipe',    veiculo: 'Administradores',   tpl: 'D' },
  { email: 'contato@jovemnerd.com.br',              nome: 'Equipe',    veiculo: 'Nerdcast',          tpl: 'D' },
  { email: 'redacao@estadao.com',                   nome: 'Equipe',    veiculo: 'Estadão',           tpl: 'E' },
];

const BATCH2: Target[] = [
  { email: 'redacao@exame.com',               nome: 'Equipe',    veiculo: 'Exame',                        tpl: 'A' },
  { email: 'contato@hbrbr.com.br',            nome: 'Equipe',    veiculo: 'Harvard Business Review Brasil', tpl: 'C' },
  { email: 'contato@pizzadedados.com',         nome: 'Equipe',    veiculo: 'Pizza de Dados',               tpl: 'D' },
  { email: 'paulo.silveira@alura.com.br',      nome: 'Paulo',     veiculo: 'Hipsters.tech',                tpl: 'D' },
  { email: 'aline.sordili@uol.com.br',         nome: 'Aline',     veiculo: 'UOL Economia',                 tpl: 'E' },
  { email: 'mauricio.meireles@uol.com.br',     nome: 'Mauricio',  veiculo: 'Folha de S.Paulo',             tpl: 'E' },
  { email: 'rennan.setti@globo.com',           nome: 'Rennan',    veiculo: 'O Globo',                      tpl: 'E' },
];

async function main() {
  const batchArg = process.argv.find(a => a.startsWith('--batch='))?.split('=')[1] ?? '2';
  const targets  = batchArg === '1b' ? BATCH1_EXTRA : BATCH2;

  const linksCtx = parseML(fs.readFileSync(path.join(ROOT, 'vault/imprensa/contexto/links.md'), 'utf-8'));
  const autorCtx = parseInline(fs.readFileSync(path.join(ROOT, 'vault/imprensa/contexto/autor.md'), 'utf-8'));

  const resend = new Resend(loadKey());
  const today  = new Date().toISOString().split('T')[0];
  const logPath = path.join(ROOT, 'vault/imprensa/logs', `dispatch_extra_${today}.json`);

  interface LogEntry { email: string; veiculo: string; subject: string; resend_id: string; status: string; sent_at: string; }
  const logs: LogEntry[] = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf-8')) : [];

  console.log(`\n[BATCH${batchArg}] ${targets.length} emails\n`);
  let sent = 0, errors = 0;

  for (let i = 0; i < targets.length; i++) {
    const { email, nome, veiculo, tpl } = targets[i];
    const raw      = fs.readFileSync(path.join(ROOT, `vault/imprensa/templates/template_${tpl}.md`), 'utf-8');
    const tplLines = removeFM(raw).split('\n');
    const subject0 = tplLines.find(l => l.startsWith('Assunto:'))?.replace(/^Assunto:\s*/, '').trim() ?? '';
    const bodyStart = tplLines.findIndex(l => l.startsWith('Assunto:')) + 1;
    const bodyTpl   = tplLines.slice(bodyStart).join('\n').trim();

    const vars: Record<string, string> = {
      nome, veiculo,
      BLOCO_LIVRO:  autorCtx['BLOCO_LIVRO']  ?? '',
      BLOCO_TECH:   autorCtx['BLOCO_TECH']   ?? '',
      BLOCO_RH:     autorCtx['BLOCO_RH']     ?? '',
      BLOCO_DADOS:  autorCtx['BLOCO_DADOS']  ?? '',
      BLOCO_LINKS:  linksCtx['BLOCO_LINKS']  ?? '',
      ASSINATURA:   linksCtx['ASSINATURA']   ?? '',
    };

    const subject = applyVars(subject0, vars);
    const body    = applyVars(bodyTpl, vars);

    process.stdout.write(`[${i + 1}/${targets.length}] ${email} — `);

    try {
      const { data, error } = await resend.emails.send({
        from: 'contato@vrashows.com.br',
        to: email,
        subject,
        text: body,
      });
      if (error) throw new Error(error.message);

      console.log(`✓ (id: ${data?.id})`);
      logs.push({ email, veiculo, subject, resend_id: data?.id ?? '', status: 'sent', sent_at: new Date().toISOString() });
      sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗ ${msg}`);
      logs.push({ email, veiculo, subject: applyVars(subject0, vars), resend_id: '', status: `error: ${msg}`, sent_at: new Date().toISOString() });
      errors++;
    }

    fs.writeFileSync(logPath, JSON.stringify(logs, null, 2), 'utf-8');

    if (i < targets.length - 1) {
      process.stdout.write('  aguardando 30s...\n');
      await sleep(30_000);
    }
  }

  console.log(`\n[RESUMO] Enviados: ${sent} | Erros: ${errors} | Log: ${logPath}\n`);
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
