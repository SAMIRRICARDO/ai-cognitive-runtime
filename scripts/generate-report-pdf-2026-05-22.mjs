import puppeteer from "puppeteer-core";
import { writeFileSync } from "fs";
import { resolve } from "path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT_PATH = resolve("C:/Users/Administrador/Downloads/VRASHOWS_Relatorio_Completo_2026-05-22.pdf");

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10.5px; color: #1e293b; background: #fff; }
  .cover { background: #0f172a; color: #fff; padding: 60px 56px 48px; }
  .cover-brand { font-size: 28px; font-weight: 800; letter-spacing: 3px; color: #fff; font-family: Georgia, serif; margin-bottom: 4px; }
  .cover-sub { font-size: 11px; color: #94a3b8; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 44px; }
  .cover-title { font-size: 22px; font-weight: 700; color: #f1f5f9; margin-bottom: 6px; line-height: 1.3; }
  .cover-date { font-size: 12px; color: #64748b; margin-bottom: 40px; }
  .cover-kpis { display: flex; gap: 0; border-top: 1px solid #1e3a5f; padding-top: 32px; flex-wrap: wrap; }
  .kpi { flex: 1; min-width: 110px; padding-right: 24px; margin-bottom: 16px; }
  .kpi-value { font-size: 30px; font-weight: 800; color: #38bdf8; line-height: 1; margin-bottom: 4px; }
  .kpi-label { font-size: 9.5px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
  .body-wrap { padding: 36px 56px; }
  h1 { font-size: 14px; font-weight: 800; color: #0f172a; margin: 30px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #0f172a; text-transform: uppercase; letter-spacing: 0.5px; }
  h2 { font-size: 12px; font-weight: 700; color: #0f172a; margin: 20px 0 8px; }
  h3 { font-size: 10px; font-weight: 700; color: #475569; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: 0.4px; }
  p { line-height: 1.65; margin-bottom: 8px; color: #334155; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: 9px; }
  thead th { background: #0f172a; color: #fff; padding: 6px 8px; text-align: left; font-weight: 600; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.4px; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  tbody td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; color: #334155; vertical-align: middle; }
  .badge { display: inline-block; padding: 2px 6px; border-radius: 10px; font-size: 8px; font-weight: 700; text-transform: uppercase; }
  .badge-sent { background: #dcfce7; color: #166534; }
  .badge-bounce { background: #fee2e2; color: #991b1b; }
  .badge-hot { background: #fef3c7; color: #92400e; }
  .badge-followup { background: #e0f2fe; color: #0369a1; }
  .score-high { color: #059669; font-weight: 700; }
  .score-mid { color: #d97706; font-weight: 600; }
  .callout { background: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 10px 14px; margin: 10px 0; border-radius: 0 4px 4px 0; font-size: 9.5px; color: #0c4a6e; line-height: 1.6; }
  .callout-warn { background: #fff7ed; border-left: 4px solid #f97316; color: #7c2d12; }
  .callout-success { background: #f0fdf4; border-left: 4px solid #22c55e; color: #14532d; }
  .section-kpis { display: flex; gap: 10px; margin: 10px 0 18px; flex-wrap: wrap; }
  .mini-kpi { flex: 1; min-width: 90px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; text-align: center; }
  .mini-kpi-val { font-size: 22px; font-weight: 800; color: #0f172a; line-height: 1; margin-bottom: 4px; }
  .mini-kpi-label { font-size: 8px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.4px; }
  .timeline-item { border-left: 3px solid #0ea5e9; padding: 6px 0 6px 14px; margin-bottom: 4px; }
  .timeline-time { font-size: 8.5px; color: #94a3b8; font-weight: 600; }
  .timeline-desc { font-size: 9.5px; color: #1e293b; }
  .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding: 14px 0 0; font-size: 8px; color: #94a3b8; display: flex; justify-content: space-between; }
  .page-break { page-break-before: always; }
  @page { size: A4; margin: 0; }
</style>
</head>
<body>

<!-- CAPA -->
<div class="cover">
  <div class="cover-brand">VRASHOWS</div>
  <div class="cover-sub">Hub de Operações &amp; Experiência Enterprise · Futurecom 2026</div>
  <div class="cover-title">Relatório Completo de Outbound<br>Emails Enviados · Todos os Contatos</div>
  <div class="cover-date">Gerado em 22 de Maio de 2026 &nbsp;·&nbsp; Período: 19/05 – 21/05/2026 &nbsp;·&nbsp; Confidencial — Uso Interno</div>
  <div class="cover-kpis">
    <div class="kpi"><div class="kpi-value">115</div><div class="kpi-label">Total de disparos</div></div>
    <div class="kpi"><div class="kpi-value">114</div><div class="kpi-label">Enviados com sucesso</div></div>
    <div class="kpi"><div class="kpi-value">56</div><div class="kpi-label">Empresas únicas</div></div>
    <div class="kpi"><div class="kpi-value">5</div><div class="kpi-label">Campanhas executadas</div></div>
    <div class="kpi"><div class="kpi-value">76</div><div class="kpi-label">Com PDF institucional</div></div>
    <div class="kpi"><div class="kpi-value">1</div><div class="kpi-label">Bounce registrado</div></div>
    <div class="kpi"><div class="kpi-value">99,1%</div><div class="kpi-label">Taxa de entrega</div></div>
    <div class="kpi"><div class="kpi-value">D+3</div><div class="kpi-label">Follow-up · abre hoje</div></div>
  </div>
</div>

<div class="body-wrap">

<!-- RESUMO EXECUTIVO -->
<h1>1. Resumo Executivo</h1>

<div class="section-kpis">
  <div class="mini-kpi"><div class="mini-kpi-val">115</div><div class="mini-kpi-label">Total disparos</div></div>
  <div class="mini-kpi"><div class="mini-kpi-val">114</div><div class="mini-kpi-label">Enviados</div></div>
  <div class="mini-kpi"><div class="mini-kpi-val">1</div><div class="mini-kpi-label">Bounce</div></div>
  <div class="mini-kpi"><div class="mini-kpi-val">56</div><div class="mini-kpi-label">Empresas</div></div>
  <div class="mini-kpi"><div class="mini-kpi-val">5</div><div class="mini-kpi-label">Campanhas</div></div>
  <div class="mini-kpi"><div class="mini-kpi-val">76</div><div class="mini-kpi-label">Com PDF</div></div>
  <div class="mini-kpi"><div class="mini-kpi-val">99,1%</div><div class="mini-kpi-label">Entrega</div></div>
  <div class="mini-kpi"><div class="mini-kpi-val">2 dias</div><div class="mini-kpi-label">Operação</div></div>
</div>

<div class="callout callout-success">
  O sistema VRASHOWS AI operou em 2 dias úteis (19/05 e 21/05), executando <strong>5 campanhas distintas</strong> com 115 disparos para <strong>56 empresas enterprise</strong>, sendo 76 com kit de mídia PDF institucional anexado. Taxa de entrega: 99,1%. O bounce único (joao.pereira@telefonica.com) foi removido automaticamente da fila.
</div>

<h3>Linha do Tempo Operacional</h3>
<div class="timeline-item">
  <div class="timeline-time">19/05 · 08:10 – 10:23</div>
  <div class="timeline-desc"><strong>Campanha A</strong> — Telecom &amp; Enterprise Brasil · 18 disparos (5 empresas: Claro, Vivo, Telefônica, TIM, LG)</div>
</div>
<div class="timeline-item">
  <div class="timeline-time">19/05 · 14:02</div>
  <div class="timeline-desc"><strong>Campanha B</strong> — AWS + Enterprise LATAM · 6 disparos (4 empresas: AWS, Claro, Vivo, Huawei)</div>
</div>
<div class="timeline-item">
  <div class="timeline-time">19/05 · 19:28 – 19:37</div>
  <div class="timeline-desc"><strong>Campanha C</strong> — Futurecom Top 5 HOT Leads · 5 disparos (5 empresas: Ericsson, Cisco, Nokia, TIM, Microsoft)</div>
</div>
<div class="timeline-item">
  <div class="timeline-time">21/05 · 10:04 – 10:31</div>
  <div class="timeline-desc"><strong>Campanha D</strong> — Cold Outreach Expansion · 10 disparos (8 empresas: AWS, Ellalink, WhiteStack, Net2Phone, Desktop, Vero Internet, Huawei, Vivo)</div>
</div>
<div class="timeline-item">
  <div class="timeline-time">21/05 · 12:18 – 16:04</div>
  <div class="timeline-desc"><strong>Campanha E</strong> — Follow-up Institucional com PDF · 76 disparos (56 empresas) · resend IDs rastreados</div>
</div>

<!-- CAMPANHA A -->
<h1>2. Campanha A — Telecom &amp; Enterprise Brasil (19/05 · manhã)</h1>
<p><strong>Horário:</strong> 08:10 → 10:23 &nbsp;·&nbsp; <strong>Volume:</strong> 18 disparos &nbsp;·&nbsp; <strong>Enviados:</strong> 17 &nbsp;·&nbsp; <strong>Bounce:</strong> 1</p>

<table>
  <thead><tr><th>#</th><th>Empresa</th><th>Email</th><th>Horário</th><th>Status</th></tr></thead>
  <tbody>
    <tr><td>1</td><td>Claro</td><td>ana.silva@claro.com</td><td>08:10</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>2</td><td>Vivo</td><td>maria.santos@vivo.com</td><td>08:18</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>3</td><td>Telefônica</td><td>joao.pereira@telefonica.com</td><td>08:25</td><td><span class="badge badge-bounce">⚠ Bounce</span></td></tr>
    <tr><td>4</td><td>TIM</td><td>carlos@tim.com</td><td>08:33</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>5</td><td>LG</td><td>bruna@lg.com</td><td>08:44</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>6</td><td>Claro</td><td>patricia@claro.com</td><td>08:52</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>7</td><td>Vivo</td><td>rodrigo@vivo.com</td><td>09:00</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>8</td><td>Telefônica</td><td>mariana@telefonica.com</td><td>09:08</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>9</td><td>TIM</td><td>lucas@tim.com</td><td>09:16</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>10</td><td>LG</td><td>fernanda@lg.com</td><td>09:23</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>11</td><td>Claro</td><td>felipe@claro.com</td><td>09:30</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>12</td><td>Vivo</td><td>juliana@vivo.com</td><td>09:38</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>13</td><td>Telefônica</td><td>bruno@telefonica.com</td><td>09:45</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>14</td><td>TIM</td><td>sofia@tim.com</td><td>09:52</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>15</td><td>LG</td><td>marcelo@lg.com</td><td>10:00</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>16</td><td>Claro</td><td>roberta@claro.com</td><td>10:08</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>17</td><td>Vivo</td><td>andre@vivo.com</td><td>10:15</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>18</td><td>Telefônica</td><td>claudia@telefonica.com</td><td>10:23</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
  </tbody>
</table>
<div class="callout callout-warn">Bounce: <strong>joao.pereira@telefonica.com</strong> — motivo: invalid_recipient · removido automaticamente da fila · buscar contato alternativo na Telefônica.</div>

<!-- CAMPANHA B -->
<h1>3. Campanha B — AWS + Enterprise LATAM (19/05 · tarde)</h1>
<p><strong>Horário:</strong> 14:02 &nbsp;·&nbsp; <strong>Volume:</strong> 6 disparos &nbsp;·&nbsp; <strong>Todos enviados</strong></p>

<table>
  <thead><tr><th>#</th><th>Empresa</th><th>Contato</th><th>Email</th><th>Horário</th><th>Status</th></tr></thead>
  <tbody>
    <tr><td>1</td><td>AWS</td><td>Rachel Louise Wilson</td><td>rachel.wilson@amazon.com</td><td>14:02:23</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>2</td><td>Claro</td><td>Bruno Carvalho</td><td>bruno.carvalho@claro.com.br</td><td>14:02:26</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>3</td><td>AWS</td><td>Aishwarya Murali</td><td>aishwarya.murali@amazon.com</td><td>14:02:29</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>4</td><td>Claro</td><td>Fernanda Costa</td><td>fernanda.costa@claro.com.br</td><td>14:02:31</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>5</td><td>Vivo / Telefônica</td><td>Mariana Rocha</td><td>mariana.rocha@telefonica.com.br</td><td>14:02:33</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
    <tr><td>6</td><td>Huawei</td><td>Ana Lima</td><td>ana.lima@huawei.com</td><td>14:02:35</td><td><span class="badge badge-sent">✓ Enviado</span></td></tr>
  </tbody>
</table>

<!-- CAMPANHA C -->
<h1>4. Campanha C — Futurecom Top 5 HOT Leads (19/05 · noite)</h1>
<p><strong>Horário:</strong> 19:28 → 19:37 &nbsp;·&nbsp; <strong>Volume:</strong> 5 disparos &nbsp;·&nbsp; Todos classificados HOT</p>

<table>
  <thead><tr><th>#</th><th>Empresa</th><th>Contato</th><th>Cargo</th><th>Email</th><th>Score</th><th>Status</th></tr></thead>
  <tbody>
    <tr><td>🥇1</td><td><strong>Ericsson</strong></td><td>Isabella Nascimento</td><td>Events &amp; Brand Experience Manager</td><td>isabella.nascimento@ericsson.com</td><td><span class="score-high">92</span></td><td><span class="badge badge-hot">HOT</span> <span class="badge badge-sent">✓</span></td></tr>
    <tr><td>🥈2</td><td><strong>TIM Brasil</strong></td><td>Juliana Rodrigues</td><td>Gerente de Marketing B2B &amp; Eventos</td><td>juliana.rodrigues@tim.com.br</td><td><span class="score-high">89</span></td><td><span class="badge badge-hot">HOT</span> <span class="badge badge-sent">✓</span></td></tr>
    <tr><td>🥉3</td><td><strong>Nokia</strong></td><td>Carolina Ferreira</td><td>Corporate Events &amp; Brand Manager</td><td>carolina.ferreira@nokia.com</td><td><span class="score-high">88</span></td><td><span class="badge badge-hot">HOT</span> <span class="badge badge-sent">✓</span></td></tr>
    <tr><td>4</td><td><strong>Cisco</strong></td><td>Luciana Campos</td><td>Partner &amp; Events Marketing Manager</td><td>lcampos@cisco.com</td><td><span class="score-high">87</span></td><td><span class="badge badge-hot">HOT</span> <span class="badge badge-sent">✓</span></td></tr>
    <tr><td>5</td><td><strong>Microsoft</strong></td><td>Patricia Almeida</td><td>Events &amp; Brand Experience Manager</td><td>patricia.almeida@microsoft.com</td><td><span class="score-high">86</span></td><td><span class="badge badge-hot">HOT</span> <span class="badge badge-sent">✓</span></td></tr>
  </tbody>
</table>

<div class="page-break"></div>

<!-- CAMPANHA D -->
<h1>5. Campanha D — Cold Outreach Expansion (21/05 · manhã)</h1>
<p><strong>Horário:</strong> 10:04 → 10:31 &nbsp;·&nbsp; <strong>Volume:</strong> 10 disparos &nbsp;·&nbsp; <strong>Fonte:</strong> run-cold-outreach &nbsp;·&nbsp; <strong>Resend IDs rastreados</strong></p>

<table>
  <thead><tr><th>#</th><th>Empresa</th><th>Contato</th><th>Email</th><th>Resend ID</th><th>Horário</th><th>Status</th></tr></thead>
  <tbody>
    <tr><td>1</td><td>AWS</td><td>Marcio Pitel</td><td>marcio.pitel@amazon.com</td><td style="font-size:7.5px;color:#94a3b8">4096d426</td><td>10:04:43</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>2</td><td>AWS</td><td>Raphael Lima</td><td>raphael.lima@amazon.com</td><td style="font-size:7.5px;color:#94a3b8">62889b3e</td><td>10:07:43</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>3</td><td>AWS</td><td>Jayme Faria</td><td>jayme.faria@amazon.com</td><td style="font-size:7.5px;color:#94a3b8">70372056</td><td>10:10:43</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>4</td><td>Ellalink</td><td>João Pereira</td><td>joao.pereira@ellalink.com</td><td style="font-size:7.5px;color:#94a3b8">df5994c9</td><td>10:13:44</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>5</td><td>WhiteStack</td><td>André Correia</td><td>andre.correia@whitestack.com</td><td style="font-size:7.5px;color:#94a3b8">0b5c2255</td><td>10:16:44</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>6</td><td>Net2Phone</td><td>Mariana Silva</td><td>mariana.silva@net2phone.com</td><td style="font-size:7.5px;color:#94a3b8">d7306472</td><td>10:19:45</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>7</td><td>Desktop</td><td>Carlos Mendes</td><td>carlos.mendes@desktop.com.br</td><td style="font-size:7.5px;color:#94a3b8">8f5900a2</td><td>10:22:45</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>8</td><td>Vero Internet</td><td>Fernanda Silva</td><td>fernanda.silva@verointernet.com.br</td><td style="font-size:7.5px;color:#94a3b8">5e0303a0</td><td>10:25:46</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>9</td><td>Huawei</td><td>Roberto Chen</td><td>roberto.chen@huawei.com</td><td style="font-size:7.5px;color:#94a3b8">a92d636f</td><td>10:28:46</td><td><span class="badge badge-sent">✓</span></td></tr>
    <tr><td>10</td><td>Vivo</td><td>Carlos Mendes</td><td>carlos.mendes@telefonica.com.br</td><td style="font-size:7.5px;color:#94a3b8">088cfc95</td><td>10:31:46</td><td><span class="badge badge-sent">✓</span></td></tr>
  </tbody>
</table>

<!-- CAMPANHA E -->
<h1>6. Campanha E — Follow-up Institucional com PDF (21/05 · tarde)</h1>
<p><strong>Horário:</strong> 12:18 → 16:04 &nbsp;·&nbsp; <strong>Volume:</strong> 76 disparos &nbsp;·&nbsp; <strong>Assunto:</strong> "VRASHOWS · material institucional para o Futurecom 2026" &nbsp;·&nbsp; PDF: vrashows_media_kit_optimized.pdf &nbsp;·&nbsp; <strong>0 falhas</strong></p>

<div class="callout callout-success">
  Todos os 76 emails foram entregues com o kit de mídia PDF anexado e Resend ID individual rastreado. Tempo médio por envio: ~181 segundos (rate-limited por design).
</div>

<table>
  <thead><tr><th>#</th><th>Empresa</th><th>Contato</th><th>Email</th><th>Resend ID</th><th>Enviado às</th></tr></thead>
  <tbody>
    <tr><td>1</td><td>TIM</td><td>—</td><td>carlos@tim.com</td><td style="font-size:7.5px;color:#94a3b8">baa129a1</td><td>12:18:16</td></tr>
    <tr><td>2</td><td>LG</td><td>—</td><td>bruna@lg.com</td><td style="font-size:7.5px;color:#94a3b8">8bcbcd21</td><td>12:21:17</td></tr>
    <tr><td>3</td><td>Claro</td><td>—</td><td>patricia@claro.com</td><td style="font-size:7.5px;color:#94a3b8">18c71ac9</td><td>12:24:18</td></tr>
    <tr><td>4</td><td>Vivo</td><td>—</td><td>rodrigo@vivo.com</td><td style="font-size:7.5px;color:#94a3b8">f5a08119</td><td>12:27:20</td></tr>
    <tr><td>5</td><td>Telefônica</td><td>—</td><td>mariana@telefonica.com</td><td style="font-size:7.5px;color:#94a3b8">6253cdc1</td><td>12:30:20</td></tr>
    <tr><td>6</td><td>TIM</td><td>—</td><td>lucas@tim.com</td><td style="font-size:7.5px;color:#94a3b8">f7c0dac6</td><td>12:33:22</td></tr>
    <tr><td>7</td><td>LG</td><td>—</td><td>fernanda@lg.com</td><td style="font-size:7.5px;color:#94a3b8">d2655d9b</td><td>12:36:22</td></tr>
    <tr><td>8</td><td>Claro</td><td>—</td><td>felipe@claro.com</td><td style="font-size:7.5px;color:#94a3b8">5234d2b8</td><td>12:39:24</td></tr>
    <tr><td>9</td><td>Vivo</td><td>—</td><td>juliana@vivo.com</td><td style="font-size:7.5px;color:#94a3b8">3b1ee1dc</td><td>12:42:25</td></tr>
    <tr><td>10</td><td>Telefônica</td><td>—</td><td>bruno@telefonica.com</td><td style="font-size:7.5px;color:#94a3b8">fe209d4e</td><td>12:45:26</td></tr>
    <tr><td>11</td><td>TIM</td><td>—</td><td>sofia@tim.com</td><td style="font-size:7.5px;color:#94a3b8">b5e74154</td><td>12:48:27</td></tr>
    <tr><td>12</td><td>LG</td><td>—</td><td>marcelo@lg.com</td><td style="font-size:7.5px;color:#94a3b8">2356fe14</td><td>12:51:28</td></tr>
    <tr><td>13</td><td>Claro</td><td>—</td><td>roberta@claro.com</td><td style="font-size:7.5px;color:#94a3b8">8f9c468d</td><td>12:54:29</td></tr>
    <tr><td>14</td><td>Vivo</td><td>—</td><td>andre@vivo.com</td><td style="font-size:7.5px;color:#94a3b8">58e9ded5</td><td>12:57:31</td></tr>
    <tr><td>15</td><td>Telefônica</td><td>—</td><td>claudia@telefonica.com</td><td style="font-size:7.5px;color:#94a3b8">bafa1bae</td><td>13:00:32</td></tr>
    <tr><td>16</td><td>AWS</td><td>Rachel Louise Wilson</td><td>rachel.wilson@amazon.com</td><td style="font-size:7.5px;color:#94a3b8">91df04d4</td><td>13:03:33</td></tr>
    <tr><td>17</td><td>Claro</td><td>Bruno Carvalho</td><td>bruno.carvalho@claro.com.br</td><td style="font-size:7.5px;color:#94a3b8">23961bad</td><td>13:06:34</td></tr>
    <tr><td>18</td><td>AWS</td><td>Aishwarya Murali</td><td>aishwarya.murali@amazon.com</td><td style="font-size:7.5px;color:#94a3b8">99d89915</td><td>13:09:35</td></tr>
    <tr><td>19</td><td>Claro</td><td>Fernanda Costa</td><td>fernanda.costa@claro.com.br</td><td style="font-size:7.5px;color:#94a3b8">a845b4a8</td><td>13:12:36</td></tr>
    <tr><td>20</td><td>Vivo</td><td>Mariana Rocha</td><td>mariana.rocha@telefonica.com.br</td><td style="font-size:7.5px;color:#94a3b8">f8d5ec1e</td><td>13:15:37</td></tr>
    <tr><td>21</td><td>Huawei</td><td>Ana Lima</td><td>ana.lima@huawei.com</td><td style="font-size:7.5px;color:#94a3b8">06d0c171</td><td>13:18:38</td></tr>
    <tr><td>22</td><td>Ericsson</td><td>Isabella Nascimento</td><td>isabella.nascimento@ericsson.com</td><td style="font-size:7.5px;color:#94a3b8">4a611d9c</td><td>13:21:38</td></tr>
    <tr><td>23</td><td>Cisco</td><td>Luciana Campos</td><td>lcampos@cisco.com</td><td style="font-size:7.5px;color:#94a3b8">ab6c4cad</td><td>13:24:39</td></tr>
    <tr><td>24</td><td>Nokia</td><td>Carolina Ferreira</td><td>carolina.ferreira@nokia.com</td><td style="font-size:7.5px;color:#94a3b8">7ef88c41</td><td>13:27:40</td></tr>
    <tr><td>25</td><td>TIM</td><td>Juliana Rodrigues</td><td>juliana.rodrigues@tim.com.br</td><td style="font-size:7.5px;color:#94a3b8">30d38b3e</td><td>13:30:41</td></tr>
    <tr><td>26</td><td>Microsoft</td><td>Patricia Almeida</td><td>patricia.almeida@microsoft.com</td><td style="font-size:7.5px;color:#94a3b8">dddec62a</td><td>13:33:42</td></tr>
    <tr><td>27</td><td>Embratel</td><td>Camila Pereira</td><td>camila.pereira@embratel.com.br</td><td style="font-size:7.5px;color:#94a3b8">e4562b1a</td><td>13:36:43</td></tr>
    <tr><td>28</td><td>V.tal</td><td>Caio Mendes</td><td>caio.mendes@vtal.com.br</td><td style="font-size:7.5px;color:#94a3b8">b36a9930</td><td>13:39:44</td></tr>
    <tr><td>29</td><td>IBM</td><td>Marcos Santos</td><td>marcos.santos@ibm.com</td><td style="font-size:7.5px;color:#94a3b8">c825331c</td><td>13:42:45</td></tr>
    <tr><td>30</td><td>Oracle</td><td>Renata Barbosa</td><td>renata.barbosa@oracle.com</td><td style="font-size:7.5px;color:#94a3b8">3b416dc9</td><td>13:45:46</td></tr>
    <tr><td>31</td><td>ZTE</td><td>Marcelo Chen</td><td>marcelo.chen@zte.com.cn</td><td style="font-size:7.5px;color:#94a3b8">a0ccb459</td><td>13:48:47</td></tr>
    <tr><td>32</td><td>HPE</td><td>Rodrigo Carvalho</td><td>rodrigo.carvalho@hpe.com</td><td style="font-size:7.5px;color:#94a3b8">73bad58d</td><td>13:51:48</td></tr>
    <tr><td>33</td><td>Dell Technologies</td><td>Natalia Gomes</td><td>natalia.gomes@dell.com</td><td style="font-size:7.5px;color:#94a3b8">f98c924f</td><td>13:54:49</td></tr>
    <tr><td>34</td><td>SAP</td><td>Eduardo Martins</td><td>eduardo.martins@sap.com</td><td style="font-size:7.5px;color:#94a3b8">1d7fadc3</td><td>13:57:50</td></tr>
    <tr><td>35</td><td>Salesforce</td><td>Larissa Souza</td><td>larissa.souza@salesforce.com</td><td style="font-size:7.5px;color:#94a3b8">2196a86d</td><td>14:00:51</td></tr>
    <tr><td>36</td><td>TOTVS</td><td>Gabriel Ribeiro</td><td>gabriel.ribeiro@totvs.com</td><td style="font-size:7.5px;color:#94a3b8">62679c29</td><td>14:03:52</td></tr>
    <tr><td>37</td><td>Algar Telecom</td><td>Beatriz Lima</td><td>beatriz.lima@algartelecom.com.br</td><td style="font-size:7.5px;color:#94a3b8">c7ffc77b</td><td>14:06:53</td></tr>
    <tr><td>38</td><td>Fortinet</td><td>Amanda Costa</td><td>amanda.costa@fortinet.com</td><td style="font-size:7.5px;color:#94a3b8">a8996f6b</td><td>14:09:54</td></tr>
    <tr><td>39</td><td>Palo Alto Networks</td><td>Lucas Almeida</td><td>lucas.almeida@paloaltonetworks.com</td><td style="font-size:7.5px;color:#94a3b8">c2b4e35c</td><td>14:12:55</td></tr>
    <tr><td>40</td><td>Intelbras</td><td>Alessandra Rocha</td><td>alessandra.rocha@intelbras.com.br</td><td style="font-size:7.5px;color:#94a3b8">3ef05859</td><td>14:15:56</td></tr>
    <tr><td>41</td><td>Equinix</td><td>André Ferreira</td><td>andre.ferreira@equinix.com</td><td style="font-size:7.5px;color:#94a3b8">7885fd9c</td><td>14:18:57</td></tr>
    <tr><td>42</td><td>Check Point</td><td>Felipe Rodrigues</td><td>felipe.rodrigues@checkpoint.com</td><td style="font-size:7.5px;color:#94a3b8">ed6e559d</td><td>14:21:58</td></tr>
    <tr><td>43</td><td>Ascenty</td><td>Thaís Araújo</td><td>thais.araujo@ascenty.com</td><td style="font-size:7.5px;color:#94a3b8">7ea2bbc1</td><td>14:24:59</td></tr>
    <tr><td>44</td><td>ServiceNow</td><td>Fernanda Silva</td><td>fernanda.silva@servicenow.com</td><td style="font-size:7.5px;color:#94a3b8">64284ccc</td><td>14:27:59</td></tr>
    <tr><td>45</td><td>Stefanini</td><td>Marina Costa</td><td>marina.costa@stefanini.com</td><td style="font-size:7.5px;color:#94a3b8">2c7d82b9</td><td>14:31:01</td></tr>
    <tr><td>46</td><td>Capgemini</td><td>Bianca Santos</td><td>bianca.santos@capgemini.com</td><td style="font-size:7.5px;color:#94a3b8">83201551</td><td>14:34:02</td></tr>
    <tr><td>47</td><td>Meta</td><td>Marina Alves</td><td>marina.alves@meta.com</td><td style="font-size:7.5px;color:#94a3b8">4bf71a29</td><td>14:37:07</td></tr>
    <tr><td>48</td><td>Ciena</td><td>Rafael Mendes</td><td>rafael.mendes@ciena.com</td><td style="font-size:7.5px;color:#94a3b8">a9803cdd</td><td>14:40:08</td></tr>
    <tr><td>49</td><td>HCLTech</td><td>João Ricardo</td><td>joao.ricardo@hcltech.com</td><td style="font-size:7.5px;color:#94a3b8">e455cc60</td><td>14:43:09</td></tr>
    <tr><td>50</td><td>Tech Mahindra</td><td>Daniela Costa</td><td>daniela.costa@techmahindra.com</td><td style="font-size:7.5px;color:#94a3b8">72e56d75</td><td>14:46:10</td></tr>
    <tr><td>51</td><td>IHS Towers</td><td>Ricardo Mendes</td><td>ricardo.mendes@ihstowers.com</td><td style="font-size:7.5px;color:#94a3b8">f0db5415</td><td>14:49:11</td></tr>
    <tr><td>52</td><td>FiberHome</td><td>Fernanda Costa</td><td>fernanda.costa@fiberhome.com</td><td style="font-size:7.5px;color:#94a3b8">f45a6746</td><td>14:52:12</td></tr>
    <tr><td>53</td><td>Viasat</td><td>João Baptista</td><td>joao.baptista@viasat.com</td><td style="font-size:7.5px;color:#94a3b8">6cce5d2c</td><td>14:55:13</td></tr>
    <tr><td>54</td><td>John Deere</td><td>Rafael Gomes</td><td>rafael.gomes@deere.com.br</td><td style="font-size:7.5px;color:#94a3b8">3e57bdc3</td><td>14:58:14</td></tr>
    <tr><td>55</td><td>Telxius</td><td>Santiago García</td><td>santiago.garcia@telxius.com</td><td style="font-size:7.5px;color:#94a3b8">b6a9616b</td><td>15:01:15</td></tr>
    <tr><td>56</td><td>Twilio</td><td>Camila Souza</td><td>camila.souza@twilio.com</td><td style="font-size:7.5px;color:#94a3b8">6079899c</td><td>15:04:16</td></tr>
    <tr><td>57</td><td>Eutelsat Brasil</td><td>Fernanda Oliveira</td><td>fernanda.oliveira@eutelsat.com</td><td style="font-size:7.5px;color:#94a3b8">cbd02bed</td><td>15:07:17</td></tr>
    <tr><td>58</td><td>Seaborn</td><td>Fernanda Ribeiro</td><td>fernanda.ribeiro@seabornnetworks.com</td><td style="font-size:7.5px;color:#94a3b8">f5a119f6</td><td>15:10:18</td></tr>
    <tr><td>59</td><td>VIAVI Solutions</td><td>Pedro Alves</td><td>pedro.alves@viavisolutions.com</td><td style="font-size:7.5px;color:#94a3b8">f0071386</td><td>15:13:19</td></tr>
    <tr><td>60</td><td>ManageEngine</td><td>Bruno Mendes</td><td>bruno.mendes@manageengine.com</td><td style="font-size:7.5px;color:#94a3b8">eb6e359a</td><td>15:16:20</td></tr>
    <tr><td>61</td><td>IFS</td><td>Fernanda Rocha</td><td>fernanda.rocha@ifs.com</td><td style="font-size:7.5px;color:#94a3b8">2a001cdb</td><td>15:19:20</td></tr>
    <tr><td>62</td><td>Fujikura</td><td>André Tanaka</td><td>andre.tanaka@fujikura.com</td><td style="font-size:7.5px;color:#94a3b8">98d33ad7</td><td>15:22:22</td></tr>
    <tr><td>63</td><td>Datarev</td><td>Mariana Costa</td><td>mariana.costa@datarev.com.br</td><td style="font-size:7.5px;color:#94a3b8">0f41b5f6</td><td>15:25:22</td></tr>
    <tr><td>64</td><td>Softswiss</td><td>João Goulart</td><td>joao.goulart@softswiss.com</td><td style="font-size:7.5px;color:#94a3b8">559d9950</td><td>15:28:23</td></tr>
    <tr><td>65</td><td>Telecall</td><td>Marina Ferreira</td><td>marina.ferreira@telecall.com</td><td style="font-size:7.5px;color:#94a3b8">33b89eee</td><td>15:31:24</td></tr>
    <tr><td>66</td><td>Datora Arqia</td><td>Rafael Mendonça</td><td>rafael.mendonca@datora.net</td><td style="font-size:7.5px;color:#94a3b8">6830e02e</td><td>15:34:25</td></tr>
    <tr><td>67</td><td>AWS</td><td>Marcio Pitel</td><td>marcio.pitel@amazon.com</td><td style="font-size:7.5px;color:#94a3b8">d0d02d85</td><td>15:37:26</td></tr>
    <tr><td>68</td><td>AWS</td><td>Raphael Lima</td><td>raphael.lima@amazon.com</td><td style="font-size:7.5px;color:#94a3b8">e4acd784</td><td>15:40:27</td></tr>
    <tr><td>69</td><td>AWS</td><td>Jayme Faria</td><td>jayme.faria@amazon.com</td><td style="font-size:7.5px;color:#94a3b8">5eae4e34</td><td>15:43:28</td></tr>
    <tr><td>70</td><td>Ellalink</td><td>João Pereira</td><td>joao.pereira@ellalink.com</td><td style="font-size:7.5px;color:#94a3b8">9eaa69df</td><td>15:46:29</td></tr>
    <tr><td>71</td><td>WhiteStack</td><td>André Correia</td><td>andre.correia@whitestack.com</td><td style="font-size:7.5px;color:#94a3b8">05c40333</td><td>15:49:30</td></tr>
    <tr><td>72</td><td>Net2Phone</td><td>Mariana Silva</td><td>mariana.silva@net2phone.com</td><td style="font-size:7.5px;color:#94a3b8">fd6f70d1</td><td>15:52:31</td></tr>
    <tr><td>73</td><td>Desktop</td><td>Carlos Mendes</td><td>carlos.mendes@desktop.com.br</td><td style="font-size:7.5px;color:#94a3b8">fb59572e</td><td>15:55:32</td></tr>
    <tr><td>74</td><td>Vero Internet</td><td>Fernanda Silva</td><td>fernanda.silva@verointernet.com.br</td><td style="font-size:7.5px;color:#94a3b8">9fbdecf4</td><td>15:58:32</td></tr>
    <tr><td>75</td><td>Huawei</td><td>Roberto Chen</td><td>roberto.chen@huawei.com</td><td style="font-size:7.5px;color:#94a3b8">4d3a22d5</td><td>16:01:33</td></tr>
    <tr><td>76</td><td>Vivo</td><td>Carlos Mendes</td><td>carlos.mendes@telefonica.com.br</td><td style="font-size:7.5px;color:#94a3b8">83623666</td><td>16:04:34</td></tr>
  </tbody>
</table>

<div class="page-break"></div>

<!-- MÉTRICAS CONSOLIDADAS -->
<h1>7. Métricas Consolidadas</h1>

<div class="section-kpis">
  <div class="mini-kpi"><div class="mini-kpi-val">115</div><div class="mini-kpi-label">Total disparos</div></div>
  <div class="mini-kpi"><div class="mini-kpi-val">114</div><div class="mini-kpi-label">Enviados</div></div>
  <div class="mini-kpi"><div class="mini-kpi-val">1</div><div class="mini-kpi-label">Bounce</div></div>
  <div class="mini-kpi"><div class="mini-kpi-val">99,1%</div><div class="mini-kpi-label">Taxa entrega</div></div>
  <div class="mini-kpi"><div class="mini-kpi-val">56</div><div class="mini-kpi-label">Empresas únicas</div></div>
  <div class="mini-kpi"><div class="mini-kpi-val">76</div><div class="mini-kpi-label">Com PDF anexo</div></div>
</div>

<h3>Distribuição por Empresa — Top Touchpoints</h3>
<table>
  <thead><tr><th>Empresa</th><th>Total disparos</th><th>Campanhas</th><th>Contatos</th></tr></thead>
  <tbody>
    <tr><td><strong>AWS / Amazon</strong></td><td>7</td><td>B, D, E</td><td>Rachel Wilson, Aishwarya Murali, Marcio Pitel, Raphael Lima, Jayme Faria</td></tr>
    <tr><td><strong>Claro</strong></td><td>8</td><td>A, B, E</td><td>Ana Silva, Patricia, Felipe, Roberta, Bruno Carvalho, Fernanda Costa</td></tr>
    <tr><td><strong>Vivo / Telefônica BR</strong></td><td>7</td><td>A, B, D, E</td><td>Maria Santos, Rodrigo, Juliana, André, Mariana Rocha, Carlos Mendes</td></tr>
    <tr><td><strong>Huawei</strong></td><td>4</td><td>B, D, E</td><td>Ana Lima, Roberto Chen</td></tr>
    <tr><td><strong>TIM</strong></td><td>6</td><td>A, C, E</td><td>Carlos, Lucas, Sofia, Juliana Rodrigues</td></tr>
    <tr><td><strong>Telefônica</strong></td><td>5</td><td>A, E</td><td>João Pereira (bounce), Mariana, Bruno, Claudia</td></tr>
    <tr><td><strong>LG</strong></td><td>4</td><td>A, E</td><td>Bruna, Fernanda, Marcelo</td></tr>
    <tr><td><strong>Ericsson</strong></td><td>2</td><td>C, E</td><td>Isabella Nascimento</td></tr>
    <tr><td><strong>Cisco</strong></td><td>2</td><td>C, E</td><td>Luciana Campos</td></tr>
    <tr><td><strong>Nokia</strong></td><td>2</td><td>C, E</td><td>Carolina Ferreira</td></tr>
    <tr><td><strong>Microsoft</strong></td><td>2</td><td>C, E</td><td>Patricia Almeida</td></tr>
  </tbody>
</table>

<h3>Distribuição Temporal</h3>
<table>
  <thead><tr><th>Data</th><th>Campanha</th><th>Disparos</th><th>Período</th><th>Resultado</th></tr></thead>
  <tbody>
    <tr><td>19/05/2026</td><td>A — Telecom &amp; Enterprise</td><td>18</td><td>08:10–10:23</td><td>17 enviados · 1 bounce</td></tr>
    <tr><td>19/05/2026</td><td>B — AWS + LATAM</td><td>6</td><td>14:02</td><td>6 enviados · 0 falhas</td></tr>
    <tr><td>19/05/2026</td><td>C — Futurecom TOP 5</td><td>5</td><td>19:28–19:37</td><td>5 enviados · 0 falhas</td></tr>
    <tr><td>21/05/2026</td><td>D — Cold Outreach Expansion</td><td>10</td><td>10:04–10:31</td><td>10 enviados · 0 falhas</td></tr>
    <tr><td>21/05/2026</td><td>E — Follow-up Institucional PDF</td><td>76</td><td>12:18–16:04</td><td>76 enviados · 0 falhas</td></tr>
    <tr><td colspan="2"><strong>Total</strong></td><td><strong>115</strong></td><td>—</td><td><strong>114 enviados · 1 bounce</strong></td></tr>
  </tbody>
</table>

<!-- PRÓXIMOS PASSOS -->
<h1>8. Próximos Passos — 22/05/2026</h1>

<div class="callout callout-warn">
  <strong>Hoje é D+3</strong> para o primeiro batch (enviado em 19/05). A janela de follow-up sequência D+3 está aberta. O follow-up log registra 1 contato elegível (TIM · carlos@tim.com) em modo dry-run — validar antes de disparar ao vivo.
</div>

<table>
  <thead><tr><th>#</th><th>Ação</th><th>Empresa / Contato</th><th>Prioridade</th><th>Prazo</th></tr></thead>
  <tbody>
    <tr><td>1</td><td>Disparar follow-up D+3 ao vivo</td><td>Batch A (19/05) — 17 contatos elegíveis</td><td><span class="badge badge-hot">⭐ Urgente</span></td><td>Hoje</td></tr>
    <tr><td>2</td><td>Verificar resposta Vivo</td><td>Maria Santos · maria.santos@vivo.com</td><td><span class="badge badge-hot">⭐ Máxima</span></td><td>Hoje</td></tr>
    <tr><td>3</td><td>Verificar resposta Claro</td><td>Ana Silva · ana.silva@claro.com</td><td><span class="badge badge-hot">⭐ Alta</span></td><td>Hoje</td></tr>
    <tr><td>4</td><td>Buscar contato alternativo (bounce)</td><td>Telefônica · joao.pereira@telefonica.com</td><td><span class="badge" style="background:#e2e8f0;color:#475569">Normal</span></td><td>Esta semana</td></tr>
    <tr><td>5</td><td>Configurar cron automático de envio</td><td>scheduler/outbound-scheduler.ts</td><td><span class="badge badge-hot">⭐ Alta</span></td><td>Hoje</td></tr>
    <tr><td>6</td><td>Rodar lead-acquisition hoje (22/05)</td><td>scheduler/lead-acquisition-scheduler.ts --force</td><td><span class="badge" style="background:#e2e8f0;color:#475569">Normal</span></td><td>Hoje</td></tr>
    <tr><td>7</td><td>Expandir pipeline Futurecom</td><td>25 novos leads disponíveis no pool (22/05)</td><td><span class="badge" style="background:#e2e8f0;color:#475569">Normal</span></td><td>Esta semana</td></tr>
  </tbody>
</table>

<!-- BOUNCE DETAIL -->
<h1>9. Bounce e Alertas</h1>

<table>
  <thead><tr><th>Email</th><th>Empresa</th><th>Data</th><th>Motivo</th><th>Ação recomendada</th></tr></thead>
  <tbody>
    <tr><td>joao.pereira@telefonica.com</td><td>Telefônica</td><td>19/05 · 08:25</td><td>invalid_recipient</td><td>Buscar contato via LinkedIn ou site da Telefônica</td></tr>
  </tbody>
</table>

<div class="callout">
  Taxa de bounce de <strong>0,9%</strong> (1/115) está abaixo do limite aceitável de 2%. O domínio vrashows.com.br mantém boa reputação de entrega. Monitorar após escalonamento de volume.
</div>

<div class="footer">
  <span>VRASHOWS AI Runtime &nbsp;·&nbsp; Relatório Completo de Outbound &nbsp;·&nbsp; Período: 19–21/05/2026</span>
  <span>Gerado em 22/05/2026 &nbsp;·&nbsp; Confidencial — Uso Interno &nbsp;·&nbsp; 115 disparos · 56 empresas · 5 campanhas</span>
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
