<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Plano de Lançamento — O Maior Ativo — 09/07/2026</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=DM+Mono:wght@300;400;500&family=DM+Sans:wght@300;400;500&display=swap');

:root {
  --gold: #C9A84C;
  --gold-dim: rgba(201,168,76,0.15);
  --gold-line: rgba(201,168,76,0.35);
  --ink: #0A0A08;
  --ink-2: #111110;
  --ink-3: #1A1A17;
  --ink-4: #222220;
  --white: #F5F2EC;
  --white-dim: rgba(245,242,236,0.6);
  --white-ghost: rgba(245,242,236,0.1);
  --serif: 'Playfair Display', serif;
  --mono: 'DM Mono', monospace;
  --sans: 'DM Sans', sans-serif;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 16px; }
body {
  background: var(--ink);
  color: var(--white);
  font-family: var(--sans);
  font-weight: 300;
  line-height: 1.7;
  padding: 3rem 1.5rem;
}

.page { max-width: 860px; margin: 0 auto; }

/* HEADER */
.header {
  border-bottom: 1px solid var(--gold-line);
  padding-bottom: 2.5rem;
  margin-bottom: 3rem;
}
.header-label {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--gold);
  margin-bottom: 1rem;
}
h1 {
  font-family: var(--serif);
  font-size: clamp(2rem, 5vw, 3.5rem);
  font-weight: 900;
  line-height: 1.1;
  margin-bottom: 0.3em;
}
h1 em { font-style: italic; color: var(--gold); }
.header-sub {
  font-family: var(--mono);
  font-size: 0.72rem;
  letter-spacing: 0.15em;
  color: var(--white-dim);
  text-transform: uppercase;
}
.header-meta {
  display: flex; gap: 2rem; flex-wrap: wrap;
  margin-top: 1.5rem;
}
.meta-pill {
  font-family: var(--mono);
  font-size: 0.65rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 0.3rem 0.8rem;
  border: 1px solid var(--gold-line);
  border-radius: 100px;
  color: var(--gold);
  background: var(--gold-dim);
}

/* SUMMARY GRID */
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1rem;
  margin-bottom: 3rem;
}
.summary-card {
  background: var(--ink-3);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  padding: 1.2rem 1.4rem;
}
.summary-num {
  font-family: var(--serif);
  font-size: 2.2rem;
  font-weight: 700;
  color: var(--gold);
  line-height: 1;
  margin-bottom: 0.2rem;
}
.summary-label {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--white-dim);
}

/* PHASE */
.phase {
  margin-bottom: 3.5rem;
}
.phase-header {
  display: flex; align-items: flex-start; gap: 1.2rem;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.phase-num {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--gold);
  background: var(--gold-dim);
  border: 1px solid var(--gold-line);
  border-radius: 4px;
  padding: 0.25rem 0.6rem;
  white-space: nowrap;
  margin-top: 0.2rem;
}
.phase-title {
  font-family: var(--serif);
  font-size: clamp(1.3rem, 3vw, 1.8rem);
  font-weight: 700;
  line-height: 1.2;
}
.phase-title em { font-style: italic; color: var(--gold); }
.phase-date {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  color: var(--white-dim);
  margin-top: 0.25rem;
}

/* WEEK */
.week { margin-bottom: 2rem; }
.week-label {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--white-dim);
  margin-bottom: 0.8rem;
  display: flex; align-items: center; gap: 0.6rem;
}
.week-label::after {
  content: '';
  flex: 1; height: 1px;
  background: rgba(255,255,255,0.06);
}

/* ACTION CARDS */
.actions { display: flex; flex-direction: column; gap: 0.75rem; }
.action {
  background: var(--ink-3);
  border: 1px solid rgba(255,255,255,0.06);
  border-left: 3px solid transparent;
  border-radius: 0 8px 8px 0;
  padding: 1rem 1.2rem;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 1rem;
  align-items: start;
}
.action.linkedin { border-left-color: #0A66C2; }
.action.email { border-left-color: var(--gold); }
.action.content { border-left-color: #7C3AED; }
.action.launch { border-left-color: #DC2626; }
.action.whatsapp { border-left-color: #25D366; }
.action-icon {
  font-size: 1rem;
  margin-top: 0.1rem;
  opacity: 0.8;
}
.action-body { min-width: 0; }
.action-title {
  font-weight: 500;
  font-size: 0.9rem;
  color: var(--white);
  margin-bottom: 0.2rem;
}
.action-desc {
  font-size: 0.8rem;
  color: var(--white-dim);
  line-height: 1.5;
}
.action-tag {
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 0.2rem 0.5rem;
  border-radius: 100px;
  white-space: nowrap;
}
.action.linkedin .action-tag { background: rgba(10,102,194,0.2); color: #60A5FA; border: 1px solid rgba(10,102,194,0.3); }
.action.email .action-tag { background: var(--gold-dim); color: var(--gold); border: 1px solid var(--gold-line); }
.action.content .action-tag { background: rgba(124,58,237,0.15); color: #A78BFA; border: 1px solid rgba(124,58,237,0.3); }
.action.launch .action-tag { background: rgba(220,38,38,0.15); color: #FCA5A5; border: 1px solid rgba(220,38,38,0.3); }
.action.whatsapp .action-tag { background: rgba(37,211,102,0.1); color: #4ADE80; border: 1px solid rgba(37,211,102,0.25); }

/* EMAIL TEMPLATE */
.email-box {
  background: var(--ink-4);
  border: 1px solid var(--gold-line);
  border-radius: 8px;
  padding: 1.5rem;
  margin: 1.5rem 0;
  position: relative;
}
.email-box::before {
  content: 'TEMPLATE DE EMAIL';
  position: absolute; top: -0.55rem; left: 1rem;
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: 0.15em;
  color: var(--gold);
  background: var(--ink-4);
  padding: 0 0.4rem;
}
.email-field {
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--white-dim);
  margin-bottom: 0.3rem;
}
.email-field span { color: var(--gold); }
.email-divider { height: 1px; background: rgba(255,255,255,0.06); margin: 0.8rem 0; }
.email-body {
  font-size: 0.85rem;
  line-height: 1.75;
  color: var(--white-dim);
}
.email-body strong { color: var(--white); font-weight: 500; }

/* LINKEDIN POST */
.post-box {
  background: var(--ink-4);
  border: 1px solid rgba(10,102,194,0.3);
  border-radius: 8px;
  padding: 1.5rem;
  margin: 1.5rem 0;
  position: relative;
}
.post-box::before {
  content: 'POST LINKEDIN';
  position: absolute; top: -0.55rem; left: 1rem;
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: 0.15em;
  color: #60A5FA;
  background: var(--ink-4);
  padding: 0 0.4rem;
}
.post-body {
  font-size: 0.88rem;
  line-height: 1.8;
  color: var(--white-dim);
}
.post-body strong { color: var(--white); font-weight: 500; }
.post-body em { color: var(--gold); font-style: normal; }

/* METRICS */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin: 1.5rem 0;
}
.metric-card {
  background: var(--ink-3);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  padding: 1.2rem;
}
.metric-val {
  font-family: var(--serif);
  font-size: 1.8rem;
  font-weight: 700;
  color: var(--gold);
  line-height: 1;
}
.metric-label {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--white-dim);
  margin-top: 0.3rem;
}
.metric-note {
  font-size: 0.75rem;
  color: rgba(245,242,236,0.4);
  margin-top: 0.2rem;
}

/* DIVIDER */
.divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--gold-line), transparent);
  margin: 3rem 0;
}

/* FOOTER */
.footer {
  border-top: 1px solid var(--gold-line);
  padding-top: 2rem;
  margin-top: 3rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  color: rgba(245,242,236,0.3);
  text-transform: uppercase;
}

@media print {
  body { background: white; color: black; padding: 1rem; }
  .phase { page-break-inside: avoid; }
}
</style>
</head>
<body>
<div class="page">

  <!-- HEADER -->
  <div class="header">
    <div class="header-label">// Plano estratégico de lançamento</div>
    <h1>O Maior Ativo<br><em>da Sua Empresa</em></h1>
    <div class="header-sub">Samir Ricardo · Lançamento oficial 09 de julho de 2026</div>
    <div class="header-meta">
      <span class="meta-pill">33 dias de aquecimento</span>
      <span class="meta-pill">LinkedIn + Email</span>
      <span class="meta-pill">50 emails/dia · automação</span>
      <span class="meta-pill">Público: CEOs · Diretores · CTOs</span>
    </div>
  </div>

  <!-- SUMMARY -->
  <div class="summary-grid">
    <div class="summary-card">
      <div class="summary-num">1.650</div>
      <div class="summary-label">Emails disparados até 09/07</div>
    </div>
    <div class="summary-card">
      <div class="summary-num">4</div>
      <div class="summary-label">Fases de aquecimento</div>
    </div>
    <div class="summary-card">
      <div class="summary-num">12</div>
      <div class="summary-label">Posts LinkedIn planejados</div>
    </div>
    <div class="summary-card">
      <div class="summary-num">09/07</div>
      <div class="summary-label">Lançamento oficial</div>
    </div>
  </div>

  <!-- FASE 1 -->
  <div class="phase">
    <div class="phase-header">
      <div class="phase-num">Fase 01</div>
      <div>
        <div class="phase-title">Ativação de <em>Autoridade</em></div>
        <div class="phase-date">03 jun → 15 jun · 13 dias · ~650 emails</div>
      </div>
    </div>

    <div class="week">
      <div class="week-label">Semana 1 · 03–08 jun</div>
      <div class="actions">
        <div class="action linkedin">
          <div class="action-icon">💼</div>
          <div class="action-body">
            <div class="action-title">Post 1 — Lançamento do conceito Human RAG</div>
            <div class="action-desc">Primeiro post âncora. Apresentar o conceito com uma pergunta provocativa: <em>"O que acontece com décadas de experiência quando um executivo vai embora?"</em> Sem mencionar o livro ainda. Construir curiosidade.</div>
          </div>
          <div class="action-tag">LinkedIn</div>
        </div>
        <div class="action email">
          <div class="action-icon">📧</div>
          <div class="action-body">
            <div class="action-title">Sequência Email #1 — Cold outreach executivo</div>
            <div class="action-desc">Iniciar disparos para ICP (empresas 60–200 funcionários, R$15M–80M). Assunto focado em dor: perda de talentos sênior. Sem pitch de produto — apenas provocar reflexão. 50/dia.</div>
          </div>
          <div class="action-tag">Automação</div>
        </div>
        <div class="action content">
          <div class="action-icon">✍️</div>
          <div class="action-body">
            <div class="action-title">Post 2 — Hemorragia Cognitiva (conceito)</div>
            <div class="action-desc">Apresentar o termo "Hemorragia Cognitiva" com dado impactante: quanto custa substituir um executivo sênior vs. o custo de preservar seu conhecimento. Formato carrossel ou texto longo.</div>
          </div>
          <div class="action-tag">LinkedIn</div>
        </div>
      </div>
    </div>

    <div class="email-box">
      <div class="email-field"><span>Assunto:</span> A cadeira vazia na sala de reuniões</div>
      <div class="email-field"><span>Para:</span> CEO / Diretor / CTO · ICP VRAXIA</div>
      <div class="email-divider"></div>
      <div class="email-body">
        Olá, [Nome],<br><br>
        Toda empresa tem pelo menos um profissional cujo conhecimento é <strong>insubstituível</strong>.<br><br>
        Não pelo cargo. Pelo que está na cabeça dele: os contextos, os julgamentos, as decisões que ele tomou nos últimos 10, 15, 20 anos.<br><br>
        Quando esse profissional sai — por qualquer motivo — a empresa não perde um colaborador.<br><br>
        <strong>Perde décadas de inteligência organizacional construída a um custo imenso.</strong><br><br>
        Chamo isso de Hemorragia Cognitiva. É silenciosa, progressiva e quase sempre irreversível.<br><br>
        Nos próximos dias vou compartilhar o que aprendi sobre como as organizações mais inteligentes estão resolvendo esse problema.<br><br>
        Abraço,<br>
        Samir Ricardo<br>
        <em style="font-size:0.8rem;color:rgba(245,242,236,0.4);">Criador do Human RAG · vrashows.com.br/livro</em>
      </div>
    </div>

    <div class="week">
      <div class="week-label">Semana 2 · 09–15 jun</div>
      <div class="actions">
        <div class="action linkedin">
          <div class="action-icon">💼</div>
          <div class="action-body">
            <div class="action-title">Post 3 — Capital Decisório: o ativo invisível</div>
            <div class="action-desc">Definir Capital Decisório com exemplo concreto de setor financeiro ou tecnologia. Perguntar à audiência: <em>"Sua empresa sabe onde está o Capital Decisório?"</em> Engajar nos comentários ancorando no Human RAG.</div>
          </div>
          <div class="action-tag">LinkedIn</div>
        </div>
        <div class="action email">
          <div class="action-icon">📧</div>
          <div class="action-body">
            <div class="action-title">Email #2 — Follow-up com insight</div>
            <div class="action-desc">Follow-up da sequência iniciada na semana 1. Trazer dado novo: custo médio de substituição de um executivo sênior (1,5x–2x salário anual). Posicionar o problema, não a solução ainda.</div>
          </div>
          <div class="action-tag">Automação</div>
        </div>
        <div class="action content">
          <div class="action-icon">✍️</div>
          <div class="action-body">
            <div class="action-title">Post 4 — Teaser do livro (primeiro sinal)</div>
            <div class="action-desc">Primeira menção indireta ao livro: <em>"Passei os últimos meses sistematizando tudo isso em um trabalho que vai sair em julho."</em> Criar antecipação sem revelar o título ainda. Link para landing page.</div>
          </div>
          <div class="action-tag">LinkedIn</div>
        </div>
      </div>
    </div>
  </div>

  <div class="divider"></div>

  <!-- FASE 2 -->
  <div class="phase">
    <div class="phase-header">
      <div class="phase-num">Fase 02</div>
      <div>
        <div class="phase-title">Construção de <em>Antecipação</em></div>
        <div class="phase-date">16 jun → 29 jun · 14 dias · ~700 emails</div>
      </div>
    </div>

    <div class="week">
      <div class="week-label">Semana 3 · 16–22 jun</div>
      <div class="actions">
        <div class="action linkedin">
          <div class="action-icon">💼</div>
          <div class="action-body">
            <div class="action-title">Post 5 — Revelar o título do livro</div>
            <div class="action-desc">Revelar o título completo com a capa. Post de alto impacto visual. Contar a origem do livro em 3–4 parágrafos: o que gerou a ideia, quanto tempo levou, para quem foi escrito. Incluir link da Amazon e da landing page.</div>
          </div>
          <div class="action-tag">LinkedIn · Alta prioridade</div>
        </div>
        <div class="action email">
          <div class="action-icon">📧</div>
          <div class="action-body">
            <div class="action-title">Email #3 — Apresentação do livro</div>
            <div class="action-desc">Revelar o livro para a base de emails já aquecida. Assunto direto: <em>"Acabei de publicar um livro sobre o problema que discutimos"</em>. Link para Amazon + landing page. CTA claro: comprar o eBook por $9,99.</div>
          </div>
          <div class="action-tag">Automação</div>
        </div>
        <div class="action content">
          <div class="action-icon">✍️</div>
          <div class="action-body">
            <div class="action-title">Post 6 — Conceito OIP (Organizational Intelligence Preservation)</div>
            <div class="action-desc">Explicar OIP como disciplina. Posicionar como o campo emergente que o livro formaliza. Samir Ricardo como criador do framework. Ancora a autoridade intelectual antes do lançamento oficial.</div>
          </div>
          <div class="action-tag">LinkedIn</div>
        </div>
      </div>
    </div>

    <div class="post-box">
      <div class="post-body">
        <strong>Acabei de publicar meu primeiro livro.</strong><br><br>
        Levei anos para entender o problema.<br>
        Meses para sistematizar a solução.<br>
        E algumas semanas para colocar tudo isso em 200 páginas.<br><br>
        <em>→ "O Maior Ativo da Sua Empresa — E por que ele está indo embora?"</em><br><br>
        O livro fala sobre algo que toda empresa experimenta mas pouquíssimas sabem nomear:<br><br>
        A perda silenciosa de <strong>décadas de experiência, julgamento e contexto organizacional</strong> quando profissionais excepcionais saem.<br><br>
        Chamo esse fenômeno de <strong>Hemorragia Cognitiva</strong>.<br><br>
        E apresento o framework que desenvolvi para resolver: <strong>Human RAG</strong> — a arquitetura que preserva o Capital Decisório das organizações antes que ele desapareça.<br><br>
        O lançamento oficial é dia <strong>09 de julho</strong>.<br>
        Mas o eBook já está disponível na Amazon: 👇<br><br>
        <em>[link Amazon + vrashows.com.br/livro]</em><br><br>
        Para quem é esse livro?<br>
        CEOs, diretores, CTOs, líderes de RH e qualquer executivo que já perdeu um profissional insubstituível e sentiu o vazio que isso deixa.<br><br>
        Se você se identifica, me conta nos comentários.
      </div>
    </div>

    <div class="week">
      <div class="week-label">Semana 4 · 23–29 jun</div>
      <div class="actions">
        <div class="action linkedin">
          <div class="action-icon">💼</div>
          <div class="action-body">
            <div class="action-title">Post 7 — Trecho do livro (excerto)</div>
            <div class="action-desc">Publicar um trecho impactante do livro. Preferencialmente do prólogo ou do capítulo sobre Hemorragia Cognitiva. Formato texto longo. Terminar com: <em>"Capítulo completo no livro."</em></div>
          </div>
          <div class="action-tag">LinkedIn</div>
        </div>
        <div class="action email">
          <div class="action-icon">📧</div>
          <div class="action-body">
            <div class="action-title">Email #4 — Case hipotético + CTA VRAXIA</div>
            <div class="action-desc">Para leads que abriram os emails anteriores: apresentar cenário de uma empresa que perdeu seu CFO de 15 anos. Conectar ao livro e ao VRAXIA como solução operacional. CTA para agendar conversa.</div>
          </div>
          <div class="action-tag">Automação</div>
        </div>
        <div class="action content">
          <div class="action-icon">✍️</div>
          <div class="action-body">
            <div class="action-title">Post 8 — Contagem regressiva: 10 dias para o lançamento</div>
            <div class="action-desc">Post de contagem regressiva. Tom executivo, sem exagero. Revelar que o lançamento oficial acontece em 09/07 com data simbólica (feriado SP). Criar evento no LinkedIn se possível.</div>
          </div>
          <div class="action-tag">LinkedIn</div>
        </div>
      </div>
    </div>
  </div>

  <div class="divider"></div>

  <!-- FASE 3 -->
  <div class="phase">
    <div class="phase-header">
      <div class="phase-num">Fase 03</div>
      <div>
        <div class="phase-title">Semana do <em>Lançamento</em></div>
        <div class="phase-date">30 jun → 08 jul · 9 dias · ~300 emails</div>
      </div>
    </div>

    <div class="actions">
      <div class="action linkedin">
        <div class="action-icon">💼</div>
        <div class="action-body">
          <div class="action-title">Post 9 — "7 dias para o lançamento" · Por que 09/07?</div>
          <div class="action-desc">Conectar a data ao contexto: 09 de julho, Revolução Constitucionalista, São Paulo. Paralelismo com o tema do livro: preservar o que foi construído, não deixar o conhecimento se perder. Tom reflexivo e executivo.</div>
        </div>
        <div class="action-tag">LinkedIn</div>
      </div>
      <div class="action email">
        <div class="action-icon">📧</div>
        <div class="action-body">
          <div class="action-title">Email #5 — "Faltam 7 dias" · Oferta de lançamento</div>
          <div class="action-desc">Para toda a base acumulada. Assunto: <em>"Faltam 7 dias — e tenho algo para você"</em>. Oferecer acesso antecipado à landing page com conteúdo exclusivo. Criar senso de pertencimento ao grupo que acompanhou o lançamento.</div>
        </div>
        <div class="action-tag">Automação</div>
      </div>
      <div class="action linkedin">
        <div class="action-icon">💼</div>
        <div class="action-body">
          <div class="action-title">Post 10 — "3 dias" · Os 6 conceitos do livro</div>
          <div class="action-desc">Listar os 6 conceitos (Capital Decisório, Human RAG, Hemorragia Cognitiva, Cognitive Legacy, OIP, IPI) com uma linha de definição cada. Formato visual simples. Alta compartilhabilidade.</div>
        </div>
        <div class="action-tag">LinkedIn · Alta prioridade</div>
      </div>
      <div class="action linkedin">
        <div class="action-icon">💼</div>
        <div class="action-body">
          <div class="action-title">Post 11 — Véspera (08/07) · Agradecimento e convite</div>
          <div class="action-desc">Post pessoal. Tom humano. Agradecer quem acompanhou a jornada. Convidar para o lançamento oficial no dia seguinte. Pedir para as pessoas compartilharem se o tema ressoou. Link da landing page e Amazon.</div>
        </div>
        <div class="action-tag">LinkedIn</div>
      </div>
    </div>
  </div>

  <div class="divider"></div>

  <!-- FASE 4 -->
  <div class="phase">
    <div class="phase-header">
      <div class="phase-num">Fase 04</div>
      <div>
        <div class="phase-title"><em>Dia do Lançamento</em> · 09/07</div>
        <div class="phase-date">09 jul · Lançamento oficial + ativação máxima</div>
      </div>
    </div>

    <div class="actions">
      <div class="action launch">
        <div class="action-icon">🚀</div>
        <div class="action-body">
          <div class="action-title">08h00 — Post principal de lançamento</div>
          <div class="action-desc">O post mais importante de toda a campanha. Foto da capa + foto do autor. Texto de lançamento completo. Link Amazon (físico + eBook) + landing page. Pedir para a rede compartilhar. Fixar no perfil.</div>
        </div>
        <div class="action-tag">LinkedIn · Crítico</div>
      </div>
      <div class="action launch">
        <div class="action-icon">📧</div>
        <div class="action-body">
          <div class="action-title">08h00 — Email de lançamento para toda a base</div>
          <div class="action-desc">Disparo simultâneo para toda a base acumulada (até 1.650 contatos). Assunto: <em>"O livro está disponível — hoje é o dia"</em>. Texto curto, direto, link único para Amazon. Sem distrações.</div>
        </div>
        <div class="action-tag">Automação · Crítico</div>
      </div>
      <div class="action whatsapp">
        <div class="action-icon">💬</div>
        <div class="action-body">
          <div class="action-title">09h00 — WhatsApp para contatos próximos</div>
          <div class="action-desc">Mensagem pessoal para 20–30 contatos estratégicos (parceiros, ex-colegas, advisors). Pedir para comprarem o eBook e deixarem uma avaliação na Amazon — os primeiros reviews são cruciais para o algoritmo.</div>
        </div>
        <div class="action-tag">WhatsApp · Manual</div>
      </div>
      <div class="action launch">
        <div class="action-icon">⭐</div>
        <div class="action-body">
          <div class="action-title">Meta crítica do dia: 10 avaliações na Amazon</div>
          <div class="action-desc">Os primeiros reviews definem o posicionamento algorítmico do livro. Acima de 10 reviews, o livro começa a aparecer em recomendações. Priorizar WhatsApp com pedido direto de review para contatos que já compraram.</div>
        </div>
        <div class="action-tag">KPI do dia</div>
      </div>
      <div class="action linkedin">
        <div class="action-icon">💼</div>
        <div class="action-body">
          <div class="action-title">Post 12 — 18h00 · Balanço do dia de lançamento</div>
          <div class="action-desc">Post ao final do dia agradecendo a repercussão, compartilhando números se positivos (downloads, visualizações da landing page), engajando com todos os comentários do post da manhã.</div>
        </div>
        <div class="action-tag">LinkedIn</div>
      </div>
    </div>
  </div>

  <div class="divider"></div>

  <!-- MÉTRICAS -->
  <div class="phase">
    <div class="phase-header">
      <div class="phase-num">KPIs</div>
      <div>
        <div class="phase-title">Métricas de <em>Sucesso</em></div>
        <div class="phase-date">Metas mínimas para validar o lançamento</div>
      </div>
    </div>

    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-val">1.650</div>
        <div class="metric-label">Emails enviados até 09/07</div>
        <div class="metric-note">50/dia × 33 dias</div>
      </div>
      <div class="metric-card">
        <div class="metric-val">15%</div>
        <div class="metric-label">Taxa de abertura alvo</div>
        <div class="metric-note">~248 executivos engajados</div>
      </div>
      <div class="metric-card">
        <div class="metric-val">10+</div>
        <div class="metric-label">Reviews Amazon na 1ª semana</div>
        <div class="metric-note">Gatilho algorítmico KDP</div>
      </div>
      <div class="metric-card">
        <div class="metric-val">500+</div>
        <div class="metric-label">Visitas landing page</div>
        <div class="metric-note">vrashows.com.br/livro</div>
      </div>
      <div class="metric-card">
        <div class="metric-val">3+</div>
        <div class="metric-label">Leads VRAXIA qualificados</div>
        <div class="metric-note">Pipeline direto do livro</div>
      </div>
      <div class="metric-card">
        <div class="metric-val">2.000+</div>
        <div class="metric-label">Impressões LinkedIn/post</div>
        <div class="metric-note">Meta para posts âncora</div>
      </div>
    </div>
  </div>

  <!-- FOOTER -->
  <div class="footer">
    Plano gerado em 03/06/2026 · Samir Ricardo · vrashows.com.br/livro · Lançamento 09/07/2026
  </div>

</div>
</body>
</html>
