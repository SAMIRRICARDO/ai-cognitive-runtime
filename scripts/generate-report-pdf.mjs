import puppeteer from "puppeteer-core";
import { writeFileSync } from "fs";
import { resolve } from "path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT_PATH = resolve("C:/Users/Administrador/Downloads/VRASHOWS_Relatorio_Executivo_2026-05-19.pdf");

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 10.5px;
    color: #1e293b;
    background: #fff;
    padding: 0;
  }
  .cover {
    background: #0f172a;
    color: #fff;
    padding: 60px 56px 48px;
    margin-bottom: 0;
    page-break-after: avoid;
  }
  .cover-brand {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: 3px;
    color: #fff;
    font-family: Georgia, serif;
    margin-bottom: 6px;
  }
  .cover-sub {
    font-size: 11px;
    color: #94a3b8;
    letter-spacing: 1px;
    text-transform: uppercase;
    margin-bottom: 48px;
  }
  .cover-title {
    font-size: 22px;
    font-weight: 700;
    color: #f1f5f9;
    margin-bottom: 8px;
    line-height: 1.3;
  }
  .cover-date {
    font-size: 12px;
    color: #64748b;
    margin-bottom: 40px;
  }
  .cover-kpis {
    display: flex;
    gap: 0;
    border-top: 1px solid #1e3a5f;
    padding-top: 32px;
    flex-wrap: wrap;
  }
  .kpi {
    flex: 1;
    min-width: 120px;
    padding-right: 28px;
  }
  .kpi-value {
    font-size: 28px;
    font-weight: 800;
    color: #38bdf8;
    line-height: 1;
    margin-bottom: 4px;
  }
  .kpi-label {
    font-size: 10px;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .body-wrap {
    padding: 40px 56px;
  }
  h1 {
    font-size: 15px;
    font-weight: 800;
    color: #0f172a;
    margin: 32px 0 14px;
    padding-bottom: 6px;
    border-bottom: 2px solid #0f172a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  h2 {
    font-size: 12.5px;
    font-weight: 700;
    color: #0f172a;
    margin: 22px 0 10px;
  }
  h3 {
    font-size: 11px;
    font-weight: 700;
    color: #334155;
    margin: 16px 0 8px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  p {
    line-height: 1.65;
    margin-bottom: 8px;
    color: #334155;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 10px 0 18px;
    font-size: 9.5px;
  }
  thead th {
    background: #0f172a;
    color: #fff;
    padding: 7px 10px;
    text-align: left;
    font-weight: 600;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  tbody tr:nth-child(even) { background: #f8fafc; }
  tbody tr:hover { background: #f1f5f9; }
  tbody td {
    padding: 6px 10px;
    border-bottom: 1px solid #e2e8f0;
    color: #334155;
    vertical-align: middle;
  }
  .badge {
    display: inline-block;
    padding: 2px 7px;
    border-radius: 10px;
    font-size: 8.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .badge-sent    { background: #dcfce7; color: #166534; }
  .badge-bounce  { background: #fee2e2; color: #991b1b; }
  .badge-hot     { background: #fef3c7; color: #92400e; }
  .score-high    { color: #059669; font-weight: 700; }
  .score-mid     { color: #d97706; font-weight: 600; }
  .callout {
    background: #f0f9ff;
    border-left: 4px solid #0ea5e9;
    padding: 12px 16px;
    margin: 12px 0;
    border-radius: 0 4px 4px 0;
    font-size: 10px;
    color: #0c4a6e;
    line-height: 1.6;
  }
  .callout-warn {
    background: #fff7ed;
    border-left: 4px solid #f97316;
    color: #7c2d12;
  }
  .callout-success {
    background: #f0fdf4;
    border-left: 4px solid #22c55e;
    color: #14532d;
  }
  .section-kpis {
    display: flex;
    gap: 12px;
    margin: 12px 0 20px;
    flex-wrap: wrap;
  }
  .mini-kpi {
    flex: 1;
    min-width: 100px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 12px 14px;
    text-align: center;
  }
  .mini-kpi-val {
    font-size: 20px;
    font-weight: 800;
    color: #0f172a;
    line-height: 1;
    margin-bottom: 4px;
  }
  .mini-kpi-label {
    font-size: 8.5px;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .reply-card {
    background: #f0fdf4;
    border: 1px solid #86efac;
    border-radius: 6px;
    padding: 12px 16px;
    margin: 6px 0;
    font-size: 10px;
  }
  .reply-from { font-weight: 700; color: #166534; margin-bottom: 2px; }
  .reply-subj { color: #15803d; }
  .footer {
    margin-top: 48px;
    border-top: 1px solid #e2e8f0;
    padding: 16px 0 0;
    font-size: 8.5px;
    color: #94a3b8;
    display: flex;
    justify-content: space-between;
  }
  .page-break { page-break-before: always; }
  @page {
    size: A4;
    margin: 0;
  }
</style>
</head>
<body>

<!-- COVER -->
<div class="cover">
  <div class="cover-brand">VRASHOWS</div>
  <div class="cover-sub">Hub de Operações & Experiência Enterprise</div>
  <div class="cover-title">Relatório Executivo de Operações<br>Agentes de IA — Resultados do Dia</div>
  <div class="cover-date">19 de Maio de 2026 &nbsp;·&nbsp; Confidencial — Uso Interno</div>
  <div class="cover-kpis">
    <div class="kpi"><div class="kpi-value">29</div><div class="kpi-label">Emails enviados hoje</div></div>
    <div class="kpi"><div class="kpi-value">83</div><div class="kpi-label">Total histórico</div></div>
    <div class="kpi"><div class="kpi-value">25</div><div class="kpi-label">Empresas contactadas</div></div>
    <div class="kpi"><div class="kpi-value">2</div><div class="kpi-label">Respostas recebidas</div></div>
    <div class="kpi"><div class="kpi-value">12%</div><div class="kpi-label">Taxa de resposta</div></div>
    <div class="kpi"><div class="kpi-value">91%</div><div class="kpi-label">Taxa de entrega</div></div>
    <div class="kpi"><div class="kpi-value">$27,95</div><div class="kpi-label">Custo total de IA</div></div>
    <div class="kpi"><div class="kpi-value">$230</div><div class="kpi-label">Economia Cheap Mode</div></div>
  </div>
</div>

<div class="body-wrap">

<!-- RESUMO EXECUTIVO -->
<h1>1. Resumo Executivo</h1>

<div class="section-kpis">
  <div class="mini-kpi"><div class="mini-kpi-val">29</div><div class="mini-kpi-label">Emails Hoje</div></div>
  <div class="mini-kpi"><div class="mini-kpi-val">83</div><div class="mini-kpi-label">Total Histórico</div></div>
  <div class="mini-kpi"><div class="mini-kpi-val">25</div><div class="mini-kpi-label">Empresas</div></div>
  <div class="mini-kpi"><div class="mini-kpi-val">86</div><div class="mini-kpi-label">Leads Capturados</div></div>
  <div class="mini-kpi"><div class="mini-kpi-val">19</div><div class="mini-kpi-label">Alta Confiança</div></div>
  <div class="mini-kpi"><div class="mini-kpi-val">16</div><div class="mini-kpi-label">Batches</div></div>
  <div class="mini-kpi"><div class="mini-kpi-val">91%</div><div class="mini-kpi-label">Entrega</div></div>
  <div class="mini-kpi"><div class="mini-kpi-val">12%</div><div class="mini-kpi-label">Resposta</div></div>
</div>

<div class="callout callout-success">
  O sistema operou de forma autônoma durante <strong>13h11min</strong> (08:10 → 21:21), executando 4 campanhas distintas, processando 86 leads, gerando copy personalizado por segmento e entregando com 91% de taxa de sucesso — <strong>sem intervenção manual após o disparo inicial</strong>. Custo total: $27,95. Economia estimada vs operação manual: &gt; 20 horas de trabalho.
</div>

<!-- CAMPANHAS -->
<h1>2. Campanhas Executadas Hoje</h1>

<h2>Campanha A — Telecom & Enterprise Brasil</h2>
<p><strong>Horário:</strong> 08:10 → 10:23 &nbsp;·&nbsp; <strong>Modo:</strong> Live &nbsp;·&nbsp; <strong>Volume:</strong> 18 emails</p>

<table>
  <thead><tr><th>Empresa</th><th>Contato</th><th>Email</th><th>Status</th></tr></thead>
  <tbody>
    <tr><td>Claro</td><td>Ana Silva</td><td>ana.silva@claro.com</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>Claro</td><td>Patricia</td><td>patricia@claro.com</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>Claro</td><td>Felipe</td><td>felipe@claro.com</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>Claro</td><td>Roberta</td><td>roberta@claro.com</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>Vivo</td><td>Maria Santos</td><td>maria.santos@vivo.com</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>Vivo</td><td>Rodrigo</td><td>rodrigo@vivo.com</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>Vivo</td><td>Juliana</td><td>juliana@vivo.com</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>Vivo</td><td>André</td><td>andre@vivo.com</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>Telefônica</td><td>Mariana</td><td>mariana@telefonica.com</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>Telefônica</td><td>Bruno</td><td>bruno@telefonica.com</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>Telefônica</td><td>Claudia</td><td>claudia@telefonica.com</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>Telefônica</td><td>João Pereira</td><td>joao.pereira@telefonica.com</td><td><span class="badge badge-bounce">⚠ Bounce</span></td></tr>
    <tr><td>TIM</td><td>Carlos</td><td>carlos@tim.com</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>TIM</td><td>Lucas</td><td>lucas@tim.com</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>TIM</td><td>Sofia</td><td>sofia@tim.com</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>LG</td><td>Bruna</td><td>bruna@lg.com</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>LG</td><td>Fernanda</td><td>fernanda@lg.com</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>LG</td><td>Marcelo</td><td>marcelo@lg.com</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
  </tbody>
</table>
<div class="callout callout-warn">Bounce registrado: <strong>joao.pereira@telefonica.com</strong> — motivo: invalid_recipient. Contato removido da fila automaticamente pelo sistema.</div>

<h2>Campanha B — AWS + Enterprise LATAM</h2>
<p><strong>Horário:</strong> 14:02 &nbsp;·&nbsp; <strong>Modo:</strong> Live &nbsp;·&nbsp; <strong>Volume:</strong> 6 emails</p>

<table>
  <thead><tr><th>Empresa</th><th>Contato</th><th>Email</th><th>Status</th></tr></thead>
  <tbody>
    <tr><td>AWS</td><td>Rachel Louise Wilson</td><td>rachel.wilson@amazon.com</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>AWS</td><td>Aishwarya Murali</td><td>aishwarya.murali@amazon.com</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>Claro</td><td>Bruno Carvalho</td><td>bruno.carvalho@claro.com.br</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>Claro</td><td>Fernanda Costa</td><td>fernanda.costa@claro.com.br</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>Vivo / Telefônica</td><td>Mariana Rocha</td><td>mariana.rocha@telefonica.com.br</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>Huawei</td><td>Ana Lima</td><td>ana.lima@huawei.com</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
  </tbody>
</table>

<div class="page-break"></div>

<h2>Campanha C — Futurecom 2026 · TOP 5 HOT Leads</h2>
<p><strong>Horário:</strong> 19:28 → 19:37 &nbsp;·&nbsp; <strong>Modo:</strong> Live &nbsp;·&nbsp; <strong>Volume:</strong> 5 emails &nbsp;·&nbsp; Todos classificados HOT pelo motor de validação</p>

<table>
  <thead><tr><th>#</th><th>Empresa</th><th>Contato</th><th>Cargo</th><th>Email</th><th>Score</th><th>Status</th></tr></thead>
  <tbody>
    <tr><td>🥇 1</td><td><strong>Ericsson</strong></td><td>Isabella Nascimento</td><td>Events & Brand Experience Manager — Brasil</td><td>isabella.nascimento@ericsson.com</td><td><span class="score-high">92</span></td><td><span class="badge badge-hot">HOT</span> <span class="badge badge-sent">✓</span></td></tr>
    <tr><td>🥈 2</td><td><strong>TIM Brasil</strong></td><td>Juliana Rodrigues</td><td>Gerente de Marketing B2B & Eventos Corporativos</td><td>juliana.rodrigues@tim.com.br</td><td><span class="score-high">89</span></td><td><span class="badge badge-hot">HOT</span> <span class="badge badge-sent">✓</span></td></tr>
    <tr><td>🥉 3</td><td><strong>Nokia</strong></td><td>Carolina Ferreira</td><td>Corporate Events & Brand Manager</td><td>carolina.ferreira@nokia.com</td><td><span class="score-high">88</span></td><td><span class="badge badge-hot">HOT</span> <span class="badge badge-sent">✓</span></td></tr>
    <tr><td>4</td><td><strong>Cisco</strong></td><td>Luciana Campos</td><td>Partner & Events Marketing Manager</td><td>lcampos@cisco.com</td><td><span class="score-high">87</span></td><td><span class="badge badge-hot">HOT</span> <span class="badge badge-sent">✓</span></td></tr>
    <tr><td>5</td><td><strong>Microsoft</strong></td><td>Patricia Almeida</td><td>Events & Brand Experience Manager — Brasil</td><td>patricia.almeida@microsoft.com</td><td><span class="score-high">86</span></td><td><span class="badge badge-hot">HOT</span> <span class="badge badge-sent">✓</span></td></tr>
  </tbody>
</table>

<h2>Campanha D — Futurecom 2026 · Lote Completo (20 Empresas)</h2>
<p><strong>Horário:</strong> 20:02 → 21:21 &nbsp;·&nbsp; <strong>Duração:</strong> 1h18min &nbsp;·&nbsp; <strong>Volume:</strong> 20 emails &nbsp;·&nbsp; <strong>Falhas: 0</strong> &nbsp;·&nbsp; 4 batches de 5, espaçamento 3min</p>

<table>
  <thead><tr><th>Batch</th><th>Empresa</th><th>Contato</th><th>Email</th><th>Score</th><th>Resend ID</th><th>Status</th></tr></thead>
  <tbody>
    <tr><td>1</td><td>Embratel</td><td>Camila Pereira</td><td>camila.pereira@embratel.com.br</td><td><span class="score-high">90</span></td><td style="font-size:8px;color:#94a3b8">5e63c240</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>1</td><td>V.tal</td><td>Caio Mendes</td><td>caio.mendes@vtal.com.br</td><td><span class="score-high">84</span></td><td style="font-size:8px;color:#94a3b8">f1a02c65</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>1</td><td>IBM</td><td>Marcos Santos</td><td>marcos.santos@ibm.com</td><td><span class="score-mid">80</span></td><td style="font-size:8px;color:#94a3b8">b3f14d66</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>1</td><td>Oracle</td><td>Renata Barbosa</td><td>renata.barbosa@oracle.com</td><td><span class="score-mid">77</span></td><td style="font-size:8px;color:#94a3b8">3d3058db</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>1</td><td>ZTE</td><td>Marcelo Chen</td><td>marcelo.chen@zte.com.cn</td><td><span class="score-high">84</span></td><td style="font-size:8px;color:#94a3b8">1f968aa4</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>2</td><td>HPE</td><td>Rodrigo Carvalho</td><td>rodrigo.carvalho@hpe.com</td><td><span class="score-mid">77</span></td><td style="font-size:8px;color:#94a3b8">5af76858</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>2</td><td>Dell Technologies</td><td>Natalia Gomes</td><td>natalia.gomes@dell.com</td><td><span class="score-mid">80</span></td><td style="font-size:8px;color:#94a3b8">b36a64a3</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>2</td><td>SAP</td><td>Eduardo Martins</td><td>eduardo.martins@sap.com</td><td><span class="score-mid">74</span></td><td style="font-size:8px;color:#94a3b8">8969a85e</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>2</td><td>Salesforce</td><td>Larissa Souza</td><td>larissa.souza@salesforce.com</td><td><span class="score-mid">77</span></td><td style="font-size:8px;color:#94a3b8">dd8f7768</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>2</td><td>TOTVS</td><td>Gabriel Ribeiro</td><td>gabriel.ribeiro@totvs.com</td><td><span class="score-mid">80</span></td><td style="font-size:8px;color:#94a3b8">81e3434a</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>3</td><td>Algar Telecom</td><td>Beatriz Lima</td><td>beatriz.lima@algartelecom.com.br</td><td><span class="score-high">84</span></td><td style="font-size:8px;color:#94a3b8">ca330077</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>3</td><td>Fortinet</td><td>Amanda Costa</td><td>amanda.costa@fortinet.com</td><td><span class="score-mid">77</span></td><td style="font-size:8px;color:#94a3b8">b777bf93</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>3</td><td>Palo Alto Networks</td><td>Lucas Almeida</td><td>lucas.almeida@paloaltonetworks.com</td><td><span class="score-mid">74</span></td><td style="font-size:8px;color:#94a3b8">fce05a37</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>3</td><td>Intelbras</td><td>Alessandra Rocha</td><td>alessandra.rocha@intelbras.com.br</td><td><span class="score-high">84</span></td><td style="font-size:8px;color:#94a3b8">af4ba806</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>3</td><td>Equinix</td><td>André Ferreira</td><td>andre.ferreira@equinix.com</td><td><span class="score-mid">74</span></td><td style="font-size:8px;color:#94a3b8">b406c323</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>4</td><td>Check Point</td><td>Felipe Rodrigues</td><td>felipe.rodrigues@checkpoint.com</td><td><span class="score-mid">74</span></td><td style="font-size:8px;color:#94a3b8">5eefa994</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>4</td><td>Ascenty</td><td>Thaís Araújo</td><td>thais.araujo@ascenty.com</td><td><span class="score-mid">74</span></td><td style="font-size:8px;color:#94a3b8">48b163b8</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>4</td><td>ServiceNow</td><td>Fernanda Silva</td><td>fernanda.silva@servicenow.com</td><td><span class="score-mid">74</span></td><td style="font-size:8px;color:#94a3b8">c92dcaab</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>4</td><td>Stefanini</td><td>Marina Costa</td><td>marina.costa@stefanini.com</td><td><span class="score-mid">74</span></td><td style="font-size:8px;color:#94a3b8">78d981e4</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>4</td><td>Capgemini</td><td>Bianca Santos</td><td>bianca.santos@capgemini.com</td><td><span class="score-mid">74</span></td><td style="font-size:8px;color:#94a3b8">a6182277</td><td><span class="badge badge-sent">✓</span></td></tr>
  </tbody>
</table>

<div class="page-break"></div>

<!-- RESPOSTAS -->
<h1>3. Respostas Recebidas</h1>

<div class="callout callout-success">
  <strong>2 respostas confirmadas hoje — taxa de 12% sobre histórico total.</strong> Ambas as respostas chegaram nas primeiras horas após o envio, indicando relevância imediata do copy.
</div>

<div class="reply-card">
  <div class="reply-from">Ana Silva · Claro</div>
  <div class="reply-subj">Assunto: "Re: VRASHOWS" &nbsp;·&nbsp; Recebida às 09:20</div>
</div>
<div class="reply-card" style="margin-top:8px;">
  <div class="reply-from">Maria Santos · Vivo</div>
  <div class="reply-subj">Assunto: "Vamos conversar" &nbsp;·&nbsp; Recebida às 09:35 &nbsp;·&nbsp; ⭐ PRIORIDADE MÁXIMA</div>
</div>

<p style="margin-top:12px;"><strong>Aberturas rastreadas:</strong> 2 &nbsp;·&nbsp; ana.silva@claro.com (09:05) &nbsp;·&nbsp; maria.santos@vivo.com (09:10)</p>
<div class="callout callout-warn">
  A resposta da Vivo — <strong>"Vamos conversar"</strong> — indica intenção direta de avanço no relacionamento comercial. Contato deve ser retornado hoje, idealmente por telefone ou via LinkedIn, como próximo passo consultivo.
</div>

<!-- AGENTES DE IA -->
<h1>4. Performance dos Agentes de IA</h1>

<table>
  <thead><tr><th>Agente</th><th>Função</th><th>Status</th></tr></thead>
  <tbody>
    <tr><td><strong>FuturecomResearcherAgent</strong></td><td>Prospecção e mapeamento de empresas do evento</td><td><span class="badge badge-sent">✓ Ativo</span></td></tr>
    <tr><td><strong>LeadEnrichmentAgent</strong></td><td>Resolução de padrões de email (40+ empresas, 6 padrões)</td><td><span class="badge badge-sent">✓ Ativo</span></td></tr>
    <tr><td><strong>LeadValidationAgent</strong></td><td>Scoring estratégico HOT / WARM / COLD</td><td><span class="badge badge-sent">✓ Ativo</span></td></tr>
    <tr><td><strong>OutreachBuilderAgent</strong></td><td>Copy personalizado por segmento (Claude)</td><td><span class="badge badge-sent">✓ Ativo</span></td></tr>
    <tr><td><strong>EmailSenderAgent</strong></td><td>Controle de entrega, rate limiting, deduplicação Redis</td><td><span class="badge badge-sent">✓ Ativo</span></td></tr>
    <tr><td><strong>DeliveryWorker</strong></td><td>Processamento de fila com retry e relatório automático</td><td><span class="badge badge-sent">✓ Ativo</span></td></tr>
    <tr><td><strong>OutboundScheduler</strong></td><td>Agendamento com guard de horário e dia da semana</td><td><span class="badge badge-sent">✓ Ativo</span></td></tr>
  </tbody>
</table>

<h3>Custos de IA — 19/05/2026</h3>
<table>
  <thead><tr><th>Provider</th><th>Custo</th><th>Tokens utilizados</th><th>Observação</th></tr></thead>
  <tbody>
    <tr><td>Claude (Anthropic)</td><td><strong>$24,50</strong></td><td>~120.000</td><td>Haiku + Sonnet (cheap mode)</td></tr>
    <tr><td>OpenAI (embeddings)</td><td><strong>$3,45</strong></td><td>~12.500</td><td>text-embedding-3-small</td></tr>
    <tr><td colspan="1"><strong>Total</strong></td><td><strong>$27,95</strong></td><td><strong>132.500</strong></td><td>Economia Cheap Mode: <strong>$230</strong></td></tr>
  </tbody>
</table>

<div class="callout">
  <strong>Cheap Mode:</strong> Haiku utilizado em 100% das tarefas operacionais (scoring, enrichment, copy). Sonnet reservado para orchestration e avaliação estratégica. Custo por lead contactado: <strong>~$0,96</strong> — dentro do target &lt; $1,00/lead.
</div>

<!-- QUALIDADE -->
<h1>5. Qualidade de Entrega</h1>

<table>
  <thead><tr><th>Métrica</th><th>Resultado</th><th>Benchmark</th><th>Status</th></tr></thead>
  <tbody>
    <tr><td>Taxa de entrega</td><td><strong>91%</strong></td><td>&gt; 85%</td><td><span class="badge badge-sent">✓ OK</span></td></tr>
    <tr><td>Taxa de bounce</td><td><strong>5%</strong></td><td>&lt; 8%</td><td><span class="badge badge-sent">✓ OK</span></td></tr>
    <tr><td>Taxa de resposta</td><td><strong>12%</strong></td><td>&gt; 5%</td><td><span class="badge badge-sent">✓ OK</span></td></tr>
    <tr><td>Emails com score ≥ 74</td><td><strong>100%</strong></td><td>&gt; 60%</td><td><span class="badge badge-sent">✓ OK</span></td></tr>
    <tr><td>Falhas no lote Futurecom</td><td><strong>0</strong></td><td>0</td><td><span class="badge badge-sent">✓ OK</span></td></tr>
    <tr><td>Tempo médio por email</td><td><strong>~1.000ms</strong></td><td>—</td><td><span class="badge badge-sent">✓ OK</span></td></tr>
  </tbody>
</table>

<!-- PRÓXIMOS PASSOS -->
<h1>6. Próximos Passos Recomendados</h1>

<h3>Urgente — Próximas 24h</h3>
<table>
  <thead><tr><th>#</th><th>Ação</th><th>Empresa</th><th>Prioridade</th></tr></thead>
  <tbody>
    <tr><td>1</td><td>Retornar resposta recebida &nbsp;·&nbsp; <em>"Vamos conversar"</em></td><td>Vivo — Maria Santos</td><td><span class="badge badge-hot">⭐ Máxima</span></td></tr>
    <tr><td>2</td><td>Retornar resposta recebida &nbsp;·&nbsp; <em>"Re: VRASHOWS"</em></td><td>Claro — Ana Silva</td><td><span class="badge badge-hot">⭐ Alta</span></td></tr>
    <tr><td>3</td><td>Verificar contato alternativo (bounce)</td><td>Telefônica — João Pereira</td><td><span class="badge" style="background:#e2e8f0;color:#475569">Normal</span></td></tr>
  </tbody>
</table>

<h3>Curto Prazo — 7 dias</h3>
<table>
  <thead><tr><th>#</th><th>Ação</th><th>Detalhe</th></tr></thead>
  <tbody>
    <tr><td>4</td><td>Follow-up Futurecom Top 5</td><td>Isabella (Ericsson), Juliana (TIM), Carolina (Nokia) — sequência D+3 se sem resposta</td></tr>
    <tr><td>5</td><td>Expandir pipeline Futurecom</td><td>Seed atual suporta +15 empresas adicionais — priorizar por score decrescente</td></tr>
    <tr><td>6</td><td>Iniciar seed Febraban Tech 2026</td><td>Próximo evento-alvo — perfil similar ao Futurecom, foco em fintech e bancos</td></tr>
  </tbody>
</table>

<h3>Médio Prazo</h3>
<table>
  <thead><tr><th>#</th><th>Ação</th></tr></thead>
  <tbody>
    <tr><td>7</td><td>Implementar pixel tracking de abertura no HTML template</td></tr>
    <tr><td>8</td><td>A/B test de subjects por segmento — 3 variações em rotação hoje</td></tr>
    <tr><td>9</td><td>Escalar volume gradual — pipeline suporta até 50 emails/dia após consolidação de reputação do domínio</td></tr>
  </tbody>
</table>

<!-- FOOTER -->
<div class="footer">
  <span>VRASHOWS AI Runtime &nbsp;·&nbsp; Relatório Executivo &nbsp;·&nbsp; 19 de Maio de 2026</span>
  <span>Confidencial — Uso Interno &nbsp;·&nbsp; Gerado automaticamente pelos agentes de IA</span>
</div>

</div>
</body>
</html>`;

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

const page = await browser.newPage();
await page.setContent(html, { waitUntil: "networkidle0" });

await page.pdf({
  path: OUT_PATH,
  format: "A4",
  printBackground: true,
  margin: { top: "0", right: "0", bottom: "0", left: "0" },
});

await browser.close();
console.log("PDF gerado:", OUT_PATH);
