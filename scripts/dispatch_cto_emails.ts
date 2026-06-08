import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Load .env — read key directly to avoid env var precedence issues
function loadEnvKey(key: string): string {
  try {
    const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
    for (const line of env.split(/\r?\n/)) {
      const m = line.match(/^([^#=\s]+)\s*=\s*(.+)$/);
      if (m && m[1] === key) return m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* ignore */ }
  return process.env[key] ?? '';
}

const RESEND_API_KEY = loadEnvKey('RESEND_API_KEY');

const DRY_RUN = process.argv.includes('--dry-run');

const EXCLUDE = new Set([
  'felipe.cavalcanti@wildlifestudios.com',
  'marcus.fontoura@stone.com',
  'marcus.fontoura@stone.co',  // mesma pessoa, excluir ambos
  'rogerio.tessari@olist.com',
  'fabiola.marchiori@neon.com.br',
]);

const CTO_NAMES = new Set([
  'Fabio Caversan','Fernanda Weiden','Thiago Teixeira','Felipe Cavalcanti',
  'Rogerio Tessari','Daniela Binatti','Fabiola Marchiori','Gustavo Livrare',
  'Marcus Fontoura','Andre Penha',
]);

const SLEEP_MS = 30_000;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function removeFrontmatter(content: string): string {
  if (content.trimStart().startsWith('---')) {
    const end = content.indexOf('---', content.indexOf('---') + 3);
    if (end !== -1) return content.slice(end + 3).trimStart();
  }
  return content;
}

function parseInline(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of removeFrontmatter(content).split('\n')) {
    const m = line.match(/^([A-Z_]+):\s+(.+)$/);
    if (m) result[m[1]] = m[2].trim();
  }
  return result;
}

function parseMultiline(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  let key = '', lines: string[] = [];
  for (const line of removeFrontmatter(content).split('\n')) {
    const m = line.match(/^([A-Z_]+):$/);
    if (m) { if (key) result[key] = lines.join('\n').trim(); key = m[1]; lines = []; }
    else if (key) lines.push(line);
  }
  if (key) result[key] = lines.join('\n').trim();
  return result;
}

function applyVars(text: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v), text
  );
}

async function main() {
  const leads = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'leads_validados_2026-06-03.json'), 'utf-8'
  ));

  // Filter: only CTOs, not excluded, with email
  const seen = new Set<string>();
  const targets = leads.filter((l: any) => {
    if (!CTO_NAMES.has(l.full_name)) return false;
    if (!l.email || EXCLUDE.has(l.email)) return false;
    if (seen.has(l.full_name)) return false;
    seen.add(l.full_name);
    return true;
  });

  const autorCtx  = parseInline(fs.readFileSync(path.join(ROOT, 'vault/imprensa/contexto/autor.md'), 'utf-8'));
  const linksCtx  = parseMultiline(fs.readFileSync(path.join(ROOT, 'vault/imprensa/contexto/links.md'), 'utf-8'));

  // Template B — tech-focused, appropriate for CTOs
  const rawTemplate = removeFrontmatter(
    fs.readFileSync(path.join(ROOT, 'vault/imprensa/templates/template_B.md'), 'utf-8')
  );
  const lines = rawTemplate.split('\n');
  const subjectLine = lines.find(l => l.startsWith('Assunto:'))?.replace(/^Assunto:\s*/, '').trim() ?? '';
  const bodyStart   = lines.findIndex(l => l.startsWith('Assunto:')) + 1;
  const bodyTpl     = lines.slice(bodyStart).join('\n').trim();

  if (!DRY_RUN && !RESEND_API_KEY) {
    console.error('[ERRO] RESEND_API_KEY não encontrada no .env'); process.exit(1);
  }
  const resend = DRY_RUN ? null : new Resend(RESEND_API_KEY);

  if (DRY_RUN) console.log('\n[DRY-RUN] Nenhum email será enviado.\n');
  console.log(`[CTO EMAIL] ${targets.length} destinatários\n`);

  let sent = 0, errors = 0;

  for (let i = 0; i < targets.length; i++) {
    const lead = targets[i];
    const firstName = lead.first_name ?? lead.full_name.split(' ')[0];

    const vars: Record<string, string> = {
      nome: firstName,
      veiculo: lead.company_name,
      BLOCO_TECH: autorCtx['BLOCO_TECH'] ?? '',
      BLOCO_LINKS: linksCtx['BLOCO_LINKS'] ?? '',
      ASSINATURA: linksCtx['ASSINATURA'] ?? '',
    };

    const subject = applyVars(subjectLine, vars);
    const body    = applyVars(bodyTpl, vars);

    console.log(`[${i + 1}/${targets.length}] ${lead.full_name} — ${lead.company_name}`);
    console.log(`  TO      : ${lead.email}`);
    console.log(`  SUBJECT : ${subject}`);

    if (DRY_RUN) {
      console.log(`  BODY    :\n${body.split('\n').map(l => `    ${l}`).join('\n')}`);
      console.log('  ' + '─'.repeat(60));
      continue;
    }

    try {
      const { error } = await resend!.emails.send({
        from: 'contato@vrashows.com.br',
        to: lead.email,
        subject,
        text: body,
      });
      if (error) throw new Error(error.message);
      console.log(`  ✓ Enviado`);
      sent++;
    } catch (err) {
      console.log(`  ✗ Erro: ${err instanceof Error ? err.message : err}`);
      errors++;
    }

    if (i < targets.length - 1) {
      console.log(`  Aguardando 30s...\n`);
      await sleep(SLEEP_MS);
    }
  }

  if (!DRY_RUN) {
    console.log('\n[RESUMO]');
    console.log(`  Enviados : ${sent}`);
    console.log(`  Erros    : ${errors}\n`);
  }
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
