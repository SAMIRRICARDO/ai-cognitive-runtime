import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { spawn } from 'child_process';
import { Resend } from 'resend';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// BRT = UTC-3 (Brazil abolished DST in 2019 — offset is permanent)
const TARGET_ISO        = '2026-06-08T12:00:00.000Z'; // 09:00 BRT — email imprensa
const TARGET_LABEL      = '08/06/2026 às 09:00 BRT';
const LINKEDIN_ISO      = '2026-06-08T13:00:00.000Z'; // 10:00 BRT — LinkedIn DMs
const LINKEDIN_LABEL    = '08/06/2026 às 10:00 BRT';
const LINKEDIN_PROFILE  = path.join(ROOT, '.linkedin-profile'); // persistent Chrome profile
const LINKEDIN_SCRIPT   = path.join(ROOT, 'scripts', 'linkedin_dm_dispatcher.ts');

interface Contact {
  veiculo: string;
  nome_completo: string;
  cargo: string;
  editoria: string;
  email_validado: string;
  linkedin_url: string;
  cobre_ia_gestao: boolean;
  score_relevancia: number;
  template_recomendado: string;
  status: string;
  sent_at?: string;
}

interface DispatchLog {
  contact: string;
  veiculo: string;
  email: string;
  template: string;
  subject: string;
  status: 'sent' | 'error';
  error?: string;
  sent_at: string;
}

interface DispatchResult {
  sent: number;
  errors: number;
  logPath: string;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function removeFrontmatter(content: string): string {
  if (content.trimStart().startsWith('---')) {
    const start = content.indexOf('---');
    const end = content.indexOf('---', start + 3);
    if (end !== -1) return content.slice(end + 3).trimStart();
  }
  return content;
}

// Parses single-line key: value pairs — for autor.md
function parseInlineBlocks(content: string): Record<string, string> {
  const body = removeFrontmatter(content);
  const result: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const match = line.match(/^([A-Z_]+):\s+(.+)$/);
    if (match) result[match[1]] = match[2].trim();
  }
  return result;
}

// Parses multi-line sections — for links.md
// Sections start with KEY: (alone on line), end at next KEY: or EOF
function parseMultilineBlocks(content: string): Record<string, string> {
  const body = removeFrontmatter(content);
  const result: Record<string, string> = {};
  let currentKey = '';
  const currentLines: string[] = [];

  for (const line of body.split('\n')) {
    const keyMatch = line.match(/^([A-Z_]+):$/);
    if (keyMatch) {
      if (currentKey) result[currentKey] = currentLines.join('\n').trim();
      currentKey = keyMatch[1];
      currentLines.length = 0;
    } else if (currentKey) {
      currentLines.push(line);
    }
  }
  if (currentKey) result[currentKey] = currentLines.join('\n').trim();
  return result;
}

function extractSubjectAndBody(templateContent: string): { subject: string; body: string } {
  const body = removeFrontmatter(templateContent);
  const lines = body.split('\n');

  let subject = '';
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('Assunto:')) {
      subject = lines[i].replace(/^Assunto:\s*/, '').trim();
      bodyStart = i + 1;
      break;
    }
  }

  while (bodyStart < lines.length && lines[bodyStart].trim() === '') bodyStart++;

  return { subject, body: lines.slice(bodyStart).join('\n').trim() };
}

function applyVars(text: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v),
    text
  );
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function askQuestion(prompt: string): Promise<string> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, answer => { rl.close(); resolve(answer.trim()); });
  });
}

// ─── core dispatch loop ──────────────────────────────────────────────────────

async function runDispatch(dryRun: boolean, resend: Resend | null): Promise<DispatchResult> {
  const contactsPath = path.join(ROOT, 'dados_imprensa_linkedin', 'contatos_validados.json');
  const contacts: Contact[] = JSON.parse(fs.readFileSync(contactsPath, 'utf-8'));

  const eligible = contacts.filter(
    c => c.score_relevancia >= 4 && c.status !== 'enviado' && c.email_validado.trim() !== ''
  );

  if (eligible.length === 0) {
    console.log('[DISPATCHER] Nenhum contato elegível (score >= 4, email preenchido, não enviado).');
    return { sent: 0, errors: 0, logPath: '' };
  }

  const autorCtx = parseInlineBlocks(
    fs.readFileSync(path.join(ROOT, 'vault', 'imprensa', 'contexto', 'autor.md'), 'utf-8')
  );
  const linksCtx = parseMultilineBlocks(
    fs.readFileSync(path.join(ROOT, 'vault', 'imprensa', 'contexto', 'links.md'), 'utf-8')
  );

  const today = new Date().toISOString().split('T')[0];
  const logPath = path.join(ROOT, 'vault', 'imprensa', 'logs', `dispatch_${today}.json`);
  const logs: DispatchLog[] = [];

  let sentCount = 0;
  let errorCount = 0;

  if (dryRun) console.log('\n[DRY-RUN] Nenhum email será enviado. Apenas simulação.\n');
  console.log(`[DISPATCHER] ${eligible.length} contatos elegíveis\n`);

  for (let i = 0; i < eligible.length; i++) {
    const contact = eligible[i];
    const firstName = contact.nome_completo.split(' ')[0];

    console.log(`[${i + 1}/${eligible.length}] ${contact.nome_completo} — ${contact.veiculo} — ${contact.email_validado}`);

    try {
      const templatePath = path.join(
        ROOT, 'vault', 'imprensa', 'templates', `template_${contact.template_recomendado}.md`
      );
      const templateContent = fs.readFileSync(templatePath, 'utf-8');
      const { subject, body } = extractSubjectAndBody(templateContent);

      const vars: Record<string, string> = {
        nome: firstName,
        veiculo: contact.veiculo,
        BLOCO_LIVRO: autorCtx['BLOCO_LIVRO'] ?? '',
        BLOCO_TECH:  autorCtx['BLOCO_TECH']  ?? '',
        BLOCO_RH:    autorCtx['BLOCO_RH']    ?? '',
        BLOCO_DADOS: autorCtx['BLOCO_DADOS'] ?? '',
        BLOCO_LINKS: linksCtx['BLOCO_LINKS'] ?? '',
        ASSINATURA:  linksCtx['ASSINATURA']  ?? '',
      };

      const finalSubject = applyVars(subject, vars);
      const finalBody    = applyVars(body, vars);

      if (dryRun) {
        console.log(`  FROM    : contato@vrashows.com.br`);
        console.log(`  TO      : ${contact.email_validado}`);
        console.log(`  SUBJECT : ${finalSubject}`);
        console.log(`  BODY    :\n${finalBody.split('\n').map(l => `    ${l}`).join('\n')}`);
        console.log('  ' + '─'.repeat(60));
      } else {
        const { error } = await resend!.emails.send({
          from: 'contato@vrashows.com.br',
          to: contact.email_validado,
          subject: finalSubject,
          text: finalBody,
        });
        if (error) throw new Error(error.message);
        contact.status = 'enviado';
        contact.sent_at = new Date().toISOString();
        console.log(`  ✓ Enviado`);
      }

      logs.push({
        contact: contact.nome_completo,
        veiculo:  contact.veiculo,
        email:    contact.email_validado,
        template: contact.template_recomendado,
        subject:  finalSubject,
        status:   'sent',
        sent_at:  dryRun ? '[dry-run]' : (contact.sent_at ?? ''),
      });

      sentCount++;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logs.push({
        contact: contact.nome_completo,
        veiculo:  contact.veiculo,
        email:    contact.email_validado,
        template: contact.template_recomendado,
        subject:  '',
        status:   'error',
        error:    msg,
        sent_at:  new Date().toISOString(),
      });
      errorCount++;
      console.log(`  ✗ Erro: ${msg}`);
    }

    // Persist state after every send — never in dry-run
    if (!dryRun) {
      fs.writeFileSync(contactsPath, JSON.stringify(contacts, null, 2), 'utf-8');
      fs.writeFileSync(logPath, JSON.stringify(logs, null, 2), 'utf-8');
    }

    if (!dryRun && i < eligible.length - 1) {
      console.log(`  Aguardando 30s...\n`);
      await sleep(30_000);
    }
  }

  // Dry-run summary (compact)
  if (dryRun) {
    console.log('\n[RESUMO]');
    console.log('  Modo     : DRY-RUN (nenhum email enviado, nenhum arquivo alterado)');
    console.log(`  Elegíveis: ${eligible.length}`);
    console.log(`  Simulados: ${sentCount}`);
    console.log(`  Erros    : ${errorCount}`);
    console.log();
  }

  return { sent: sentCount, errors: errorCount, logPath };
}

// ─── LinkedIn DM spawner ─────────────────────────────────────────────────────

function runLinkedInDispatcher(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('\n📱 Iniciando LinkedIn DM dispatcher...\n');
    const child = spawn('npx', ['tsx', LINKEDIN_SCRIPT], {
      stdio: 'inherit',
      shell: true,
      cwd: ROOT,
    });
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`linkedin_dm_dispatcher saiu com código ${code}`));
    });
    child.on('error', reject);
  });
}

function waitUntil(isoTarget: string): Promise<void> {
  const delayMs = new Date(isoTarget).getTime() - Date.now();
  return delayMs > 0
    ? new Promise<void>(r => setTimeout(r, delayMs))
    : Promise.resolve();
}

function countdownLabel(isoTarget: string): string {
  const ms      = Math.max(0, new Date(isoTarget).getTime() - Date.now());
  const hours   = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours} horas e ${minutes} minutos`;
}

// ─── scheduler ───────────────────────────────────────────────────────────────

async function scheduleDispatch(resend: Resend): Promise<void> {
  const emailPast    = Date.now() >= new Date(TARGET_ISO).getTime();
  const linkedinPast = Date.now() >= new Date(LINKEDIN_ISO).getTime();

  // ── LinkedIn profile check ──
  const profileReady = fs.existsSync(LINKEDIN_PROFILE) &&
    fs.readdirSync(LINKEDIN_PROFILE).length > 0;
  if (!profileReady) {
    console.log('\n⚠️  Perfil LinkedIn não encontrado — na hora do disparo o Chrome vai pedir login.');
    console.log('  O login é necessário apenas uma vez (perfil fica salvo).\n');
  }

  // ── Email block ──
  if (emailPast) {
    console.log(`\n⚠️  Já passou das 09:00 BRT de 08/06/2026.`);
    const answer = await askQuestion('Disparar imprensa imediatamente? (s/n): ');
    if (answer.toLowerCase() === 's') {
      console.log('\n🚀 Iniciando disparo imediato — ' +
        new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + '\n');
      const result = await runDispatch(false, resend);
      printProductionSummary(result);
    } else {
      console.log('Disparo de imprensa cancelado.');
    }
  } else {
    console.log(`\n⏰ Dispatcher agendado para ${TARGET_LABEL}`);
    console.log(`⏳ Aguardando ${countdownLabel(TARGET_ISO)}...`);
    console.log('   (mantenha o terminal aberto)\n');

    await waitUntil(TARGET_ISO);
    console.log(`\n🚀 Iniciando disparo — 08/06/2026 09:00:00 BRT\n`);

    const result = await runDispatch(false, resend);
    printProductionSummary(result);
  }

  // ── LinkedIn block ──

  if (linkedinPast) {
    console.log(`\n⚠️  Já passou das 10:00 BRT. Disparar LinkedIn DMs agora? (s/n): `);
    const ans = await askQuestion('');
    if (ans.toLowerCase() !== 's') { console.log('LinkedIn DM cancelado.'); return; }
    await runLinkedInDispatcher();
  } else {
    const linkedInDelay = countdownLabel(LINKEDIN_ISO);
    console.log(`\n📱 LinkedIn DM agendado para ${LINKEDIN_LABEL}`);
    console.log(`⏳ Aguardando ${linkedInDelay}...\n`);

    await waitUntil(LINKEDIN_ISO);
    console.log(`\n🚀 Iniciando LinkedIn DMs — 10:00 BRT\n`);
    await runLinkedInDispatcher();
  }
}

function printProductionSummary(result: DispatchResult): void {
  console.log('\n✅ Disparo concluído');
  console.log(`📧 Enviados: ${result.sent}`);
  console.log(`❌ Erros: ${result.errors}`);
  if (result.logPath) console.log(`📁 Log: ${result.logPath}`);
  console.log();
}

// ─── entry point ─────────────────────────────────────────────────────────────

async function main() {
  const DRY_RUN = process.argv.includes('--dry-run');

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey && !DRY_RUN) {
    console.error('[ERRO] RESEND_API_KEY não definida. Use --dry-run para testar sem enviar.');
    process.exit(1);
  }

  if (DRY_RUN) {
    await runDispatch(true, null);
  } else {
    await scheduleDispatch(new Resend(apiKey!));
  }
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
