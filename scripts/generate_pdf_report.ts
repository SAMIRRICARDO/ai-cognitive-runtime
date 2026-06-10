import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const ALL_EMAILS = [
  // ── IMPRENSA ORIGINAL (dispatcher.ts) ──────────────────────────────────────
  { categoria: 'Imprensa', veiculo: 'PEGN',               contato: 'Equipe PEGN',         email: 'redacao@revistapegn.com.br',           horario: '18:03', template: 'A', delivery: 'enviado' },
  { categoria: 'Imprensa', veiculo: 'Você RH',            contato: 'Alexandre Carvalho',  email: 'voce-rh@abril.com.br',                 horario: '18:03', template: 'C', delivery: 'enviado' },
  { categoria: 'Imprensa', veiculo: 'Você S/A',           contato: 'Alexandre Carvalho',  email: 'vocesa@abril.com.br',                  horario: '18:04', template: 'C', delivery: 'enviado' },
  { categoria: 'Imprensa', veiculo: 'GPTW Brasil',        contato: 'Tatiane Tiemi',       email: 'brasil@greatplacetowork.com',          horario: '18:04', template: 'C', delivery: 'enviado' },
  { categoria: 'Imprensa', veiculo: 'Melhor RH',          contato: 'Equipe Melhor RH',    email: 'melhor@melhor.com.br',                 horario: '18:05', template: 'C', delivery: 'enviado' },
  // ── CTOs (dispatch_cto_emails.ts) ──────────────────────────────────────────
  { categoria: 'CTO',      veiculo: 'Stefanini',          contato: 'Fabio Caversan',      email: 'fabio.caversan@stefanini.com',         horario: '18:06', template: 'B', delivery: 'enviado' },
  { categoria: 'CTO',      veiculo: 'VTEX',               contato: 'Fernanda Weiden',     email: 'fernanda.weiden@vtex.com',             horario: '18:07', template: 'B', delivery: 'enviado' },
  { categoria: 'CTO',      veiculo: 'Dock',               contato: 'Thiago Teixeira',     email: 'thiago.teixeira@dock.tech',            horario: '18:08', template: 'B', delivery: 'enviado' },
  { categoria: 'CTO',      veiculo: 'Pismo',              contato: 'Daniela Binatti',     email: 'daniela.binatti@pismo.io',             horario: '18:09', template: 'B', delivery: 'enviado' },
  { categoria: 'CTO',      veiculo: 'Cora',               contato: 'Gustavo Livrare',     email: 'gustavo.livrare@cora.com.br',          horario: '18:10', template: 'B', delivery: 'enviado' },
  { categoria: 'CTO',      veiculo: 'QuintoAndar',        contato: 'Andre Penha',         email: 'andre.penha@quintoandar.com.br',       horario: '18:11', template: 'B', delivery: 'enviado' },
  // ── IMPRENSA EXTRA LOTE 1B (dispatch_batch2.ts) ────────────────────────────
  { categoria: 'Imprensa', veiculo: 'Valor Econômico',    contato: 'Joao Luiz Rosa',      email: 'joao.rosa@valor.com.br',               horario: '19:31', template: 'A', delivery: 'entregue' },
  { categoria: 'Imprensa', veiculo: 'MIT Tech Review',    contato: 'Alexandre Roldao',    email: 'alexandre.roldao@mittechreview.com.br',horario: '19:32', template: 'B', delivery: 'entregue' },
  { categoria: 'Imprensa', veiculo: 'Canaltech',          contato: 'Redação',             email: 'redacao@canaltech.com.br',             horario: '19:32', template: 'B', delivery: 'entregue' },
  { categoria: 'Imprensa', veiculo: 'Tecnoblog',          contato: 'Imprensa',            email: 'imprensa@tecnoblog.net',               horario: '19:33', template: 'B', delivery: 'entregue' },
  { categoria: 'Imprensa', veiculo: 'Startups.com.br',    contato: 'Gustavo Brigatto',    email: 'redacao@startups.com.br',              horario: '19:33', template: 'A', delivery: 'entregue' },
  { categoria: 'Imprensa', veiculo: 'Administradores',    contato: 'Leandro Vieira',      email: 'contato@administradores.com.br',       horario: '19:34', template: 'D', delivery: 'bounced'  },
  { categoria: 'Imprensa', veiculo: 'Nerdcast',           contato: 'Equipe Nerdcast',     email: 'contato@jovemnerd.com.br',             horario: '19:35', template: 'D', delivery: 'bounced'  },
  { categoria: 'Imprensa', veiculo: 'Estadão',            contato: 'Redação Estadão',     email: 'redacao@estadao.com',                  horario: '19:35', template: 'E', delivery: 'entregue' },
  // ── IMPRENSA EXTRA LOTE 2 (dispatch_batch2.ts) ─────────────────────────────
  { categoria: 'Imprensa', veiculo: 'Exame',              contato: 'Redação',             email: 'redacao@exame.com',                    horario: '19:35', template: 'A', delivery: 'entregue' },
  { categoria: 'Imprensa', veiculo: 'HBR Brasil',         contato: 'Redação',             email: 'contato@hbrbr.com.br',                 horario: '19:36', template: 'C', delivery: 'bounced'  },
  { categoria: 'Imprensa', veiculo: 'Pizza de Dados',     contato: 'Jessica Temporal',    email: 'contato@pizzadedados.com',             horario: '19:36', template: 'D', delivery: 'bounced'  },
  { categoria: 'Imprensa', veiculo: 'Hipsters.tech',      contato: 'Paulo Silveira',      email: 'paulo.silveira@alura.com.br',          horario: '19:37', template: 'D', delivery: 'entregue' },
  { categoria: 'Imprensa', veiculo: 'UOL Economia',       contato: 'Aline Sordili',       email: 'aline.sordili@uol.com.br',             horario: '19:37', template: 'E', delivery: 'bounced'  },
  { categoria: 'Imprensa', veiculo: 'Folha de S.Paulo',   contato: 'Mauricio Meireles',   email: 'mauricio.meireles@uol.com.br',         horario: '19:38', template: 'E', delivery: 'bounced'  },
  { categoria: 'Imprensa', veiculo: 'O Globo',            contato: 'Rennan Setti',        email: 'rennan.setti@globo.com',               horario: '19:38', template: 'E', delivery: 'aguardando'},
];

const EMAILS_BOUNCE = [
  { veiculo: 'Administradores',   email_invalido: 'contato@administradores.com.br', email_correto: 'suporte@administradores.com.br',    status: 'Médio' },
  { veiculo: 'Nerdcast',          email_invalido: 'contato@jovemnerd.com.br',       email_correto: 'nerdcast@jovemnerd.com.br',          status: 'Alto' },
  { veiculo: 'HBR Brasil',        email_invalido: 'contato@hbrbr.com.br',           email_correto: 'info@hbrbr.com.br',                  status: 'Alto' },
  { veiculo: 'Pizza de Dados',    email_invalido: 'contato@pizzadedados.com',       email_correto: 'pizzadedados@gmail.com',             status: 'Alto' },
  { veiculo: 'UOL / Aline Sordili', email_invalido: 'aline.sordili@uol.com.br',   email_correto: '— saiu do UOL (LinkedIn direto)',    status: 'N/A' },
  { veiculo: 'Folha / Meireles',  email_invalido: 'mauricio.meireles@uol.com.br',  email_correto: 'mauricio.meireles@folha.com.br',     status: 'Médio' },
];

const total     = ALL_EMAILS.length;
const entregues = ALL_EMAILS.filter(e => e.delivery === 'entregue').length;
const enviados  = ALL_EMAILS.filter(e => e.delivery === 'enviado').length;
const bounced   = ALL_EMAILS.filter(e => e.delivery === 'bounced').length;
const aguardando = ALL_EMAILS.filter(e => e.delivery === 'aguardando').length;

function deliveryBadge(d: string): string {
  const map: Record<string, string> = {
    entregue:   '<span class="badge green">✅ Entregue</span>',
    enviado:    '<span class="badge blue">📤 Enviado</span>',
    bounced:    '<span class="badge red">🔴 Bounced</span>',
    aguardando: '<span class="badge yellow">⏳ Aguardando</span>',
  };
  return map[d] ?? d;
}

function catBadge(c: string): string {
  return c === 'CTO'
    ? '<span class="badge purple">CTO</span>'
    : '<span class="badge gray">Imprensa</span>';
}

const rows = ALL_EMAILS.map((e, i) => `
  <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
    <td class="num">${i + 1}</td>
    <td>${catBadge(e.categoria)}</td>
    <td><strong>${e.veiculo}</strong></td>
    <td>${e.contato}</td>
    <td class="email">${e.email}</td>
    <td class="center">${e.horario} BRT</td>
    <td class="center">${e.template}</td>
    <td>${deliveryBadge(e.delivery)}</td>
  </tr>`).join('');

const bounceRows = EMAILS_BOUNCE.map(b => `
  <tr>
    <td><strong>${b.veiculo}</strong></td>
    <td class="email red-text">${b.email_invalido}</td>
    <td class="email">${b.email_correto}</td>
    <td class="center">${b.status}</td>
  </tr>`).join('');

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #1a1a2e; background: #fff; }
  .page { padding: 32px 36px; }

  /* HEADER */
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #7c3aed; padding-bottom: 16px; margin-bottom: 24px; }
  .brand h1 { font-size: 22px; font-weight: 800; color: #7c3aed; letter-spacing: -0.5px; }
  .brand p  { font-size: 11px; color: #6b7280; margin-top: 2px; }
  .meta { text-align: right; font-size: 10px; color: #6b7280; line-height: 1.6; }
  .meta strong { color: #1a1a2e; }

  /* KPIs */
  .kpis { display: flex; gap: 12px; margin-bottom: 24px; }
  .kpi  { flex: 1; background: #f8f7ff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; }
  .kpi .num  { font-size: 28px; font-weight: 800; color: #7c3aed; line-height: 1; }
  .kpi .label{ font-size: 10px; color: #6b7280; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .kpi.green .num  { color: #16a34a; }
  .kpi.red   .num  { color: #dc2626; }
  .kpi.blue  .num  { color: #2563eb; }
  .kpi.yellow .num { color: #d97706; }

  /* SECTION */
  .section-title { font-size: 13px; font-weight: 700; color: #7c3aed; margin: 20px 0 10px; text-transform: uppercase; letter-spacing: 0.5px; border-left: 3px solid #7c3aed; padding-left: 8px; }

  /* TABLE */
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th    { background: #7c3aed; color: #fff; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 7px 8px; text-align: left; }
  th.center, td.center { text-align: center; }
  td    { padding: 6px 8px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
  tr.even { background: #fafafa; }
  tr.odd  { background: #ffffff; }
  td.num  { color: #9ca3af; font-size: 9px; width: 24px; }
  td.email { font-family: monospace; font-size: 9.5px; color: #374151; }
  .red-text { color: #dc2626 !important; text-decoration: line-through; }

  /* BADGES */
  .badge { display: inline-block; padding: 2px 7px; border-radius: 10px; font-size: 9px; font-weight: 600; }
  .badge.green  { background: #dcfce7; color: #16a34a; }
  .badge.blue   { background: #dbeafe; color: #2563eb; }
  .badge.red    { background: #fee2e2; color: #dc2626; }
  .badge.yellow { background: #fef3c7; color: #d97706; }
  .badge.purple { background: #ede9fe; color: #7c3aed; }
  .badge.gray   { background: #f3f4f6; color: #6b7280; }

  /* FOOTER */
  .footer { margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 12px; display: flex; justify-content: space-between; font-size: 9px; color: #9ca3af; }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="brand">
      <h1>VRASHOWS</h1>
      <p>Relatório de Disparo de Email — Campanha de Lançamento</p>
      <p style="margin-top:6px;font-size:10px;color:#374151;">
        <strong>Livro:</strong> O Maior Ativo da Sua Empresa — E por que ele está indo embora?<br/>
        <strong>Autor:</strong> Samir Ricardo Almeida · AI Solutions Architect · Fundador VRASHOWS
      </p>
    </div>
    <div class="meta">
      <div><strong>Data do disparo:</strong> 08 de Junho de 2026</div>
      <div><strong>Plataforma:</strong> Resend API</div>
      <div><strong>Remetente:</strong> contato@vrashows.com.br</div>
      <div><strong>Gerado em:</strong> ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</div>
    </div>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="num">${total}</div><div class="label">Total Disparados</div></div>
    <div class="kpi green"><div class="num">${entregues}</div><div class="label">Entregues (confirmado)</div></div>
    <div class="kpi blue"><div class="num">${enviados}</div><div class="label">Enviados (sem confirmar)</div></div>
    <div class="kpi red"><div class="num">${bounced}</div><div class="label">Bounced</div></div>
    <div class="kpi yellow"><div class="num">${aguardando}</div><div class="label">Aguardando status</div></div>
  </div>

  <div class="section-title">Cadastro Completo de Envios</div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Tipo</th>
        <th>Veículo / Empresa</th>
        <th>Contato</th>
        <th>Email</th>
        <th class="center">Horário</th>
        <th class="center">Template</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="section-title" style="margin-top:28px;">Emails Bounced — Correções Identificadas</div>
  <table>
    <thead>
      <tr>
        <th>Veículo</th>
        <th>Email Inválido</th>
        <th>Email Correto (pesquisado)</th>
        <th class="center">Confiança</th>
      </tr>
    </thead>
    <tbody>${bounceRows}</tbody>
  </table>

  <div class="footer">
    <span>VRASHOWS · contato@vrashows.com.br · (11) 95357-7804</span>
    <span>Human RAG · VRAXIA Enterprise AI OS · github.com/SAMIRRICARDO/ai-cognitive-runtime</span>
  </div>

</div>
</body>
</html>`;

const htmlPath = path.join(ROOT, 'vault/imprensa/logs/report_2026-06-08.html');
const pdfPath  = path.join(ROOT, 'vault/imprensa/logs/report_2026-06-08.pdf');

fs.writeFileSync(htmlPath, html, 'utf-8');
console.log('HTML gerado. Convertendo para PDF...');

const browser = await chromium.launch({ headless: true });
const page    = await browser.newPage();
await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle' });
await page.pdf({
  path:   pdfPath,
  format: 'A4',
  printBackground: true,
  margin: { top: '0', bottom: '0', left: '0', right: '0' },
});
await browser.close();

console.log(`\n✅ PDF gerado: ${pdfPath}`);
console.log(`   Total: ${total} emails | Entregues: ${entregues} | Bounced: ${bounced}\n`);
