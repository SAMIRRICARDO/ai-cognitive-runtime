// packages/work/src/engine/greenhouse.ts
// GreenhouseApplyEngine — candidatura automática em job-boards.greenhouse.io

import { Page } from 'playwright';
import Anthropic from '@anthropic-ai/sdk';
import { VaultRetriever } from '../rag/retriever.js';
import { CandidateTwin, QuestionnaireQuestion } from '../types/index.js';

const delay = (min: number, max: number) =>
  new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));

export interface GreenhouseApplyOptions {
  twin: CandidateTwin;
  resumePath: string;
  dryRun?: boolean;
  onQuestion?: (q: QuestionnaireQuestion) => Promise<string>;
  /** Callback chamado para cada campo preenchido — use para logar no QuestionnaireLogger */
  onFieldFilled?: (label: string, value: string) => void;
}

// Campos de diversidade configuráveis via .env (valores padrão: "Prefiro não responder")
const DIVERSITY = {
  gender:      process.env.DIVERSITY_GENDER      ?? 'Prefiro não responder',
  orientation: process.env.DIVERSITY_ORIENTATION ?? 'Prefiro não responder',
  group:       process.env.DIVERSITY_GROUP       ?? 'Prefiro não responder',
  pcd:         process.env.DIVERSITY_PCD         ?? 'Não',
};

// Padrões de labels para campos de diversidade
const DIVERSITY_PATTERNS = [
  { re: /g[eê]nero|gender|sexo\b/i,                     value: () => DIVERSITY.gender },
  { re: /orienta[cç][aã]o sexual|sexual orientation/i,   value: () => DIVERSITY.orientation },
  { re: /ra[cç]a|etnia|race|ethnicity|grupo|group/i,    value: () => DIVERSITY.group },
  { re: /pcd|defici[eê]ncia|disability|necessidade especial/i, value: () => DIVERSITY.pcd },
];

// Checkboxes que mapeiam para o perfil técnico do candidato
const TECH_CHECKBOX_MAP: Record<string, string[]> = {
  aws:        ['s3', 'lambda', 'ec2', 'iam', 'cloudwatch', 'sqs', 'sns', 'rds', 'dynamodb'],
  azure:      ['azure functions', 'azure devops', 'azure blob', 'azure ad'],
  frameworks: ['langchain', 'openai', 'anthropic', 'huggingface', 'fastapi', 'express', 'nestjs', 'nextjs'],
  databases:  ['postgresql', 'postgres', 'pgvector', 'faiss', 'redis', 'mongodb'],
  cloud:      ['aws', 'azure', 'gcp', 'google cloud'],
  deploy:     ['docker', 'kubernetes', 'vercel', 'railway', 'ecs', 'ci/cd', 'github actions'],
};

export class GreenhouseApplyEngine {
  private client: Anthropic;

  constructor(
    private page: Page,
    private retriever: VaultRetriever,
    apiKey?: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async apply(greenhouseUrl: string, options: GreenhouseApplyOptions): Promise<boolean> {
    const { twin, resumePath, dryRun = false } = options;

    console.log(`[Greenhouse] → ${greenhouseUrl.slice(0, 80)}`);

    // Navigate to Greenhouse form
    try {
      await this.page.goto(greenhouseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch {
      await this.page.goto(greenhouseUrl, { waitUntil: 'commit', timeout: 15000 }).catch(() => {});
    }
    await delay(2000, 3000);

    // Verify we're on a Greenhouse form
    const url = this.page.url();
    const onGreenhouse = url.includes('greenhouse.io') ||
      await this.page.locator('#application_form, form#application, .application-form, form[action*="greenhouse"]').count() > 0;

    if (!onGreenhouse) {
      console.warn(`[Greenhouse] URL inesperada após redirect: ${url.slice(0, 80)}`);
      return false;
    }

    const filled: Record<string, string> = {};

    // ── Preenche campos em ordem ─────────────────────────────────────────────
    await this.fillStandardFields(twin, filled);
    await this.uploadResume(resumePath, filled);

    // Perguntas dinâmicas via QuestionnaireAgent
    if (options.onQuestion) {
      await this.handleDynamicQuestions(options.onQuestion, filled);
    }

    // Checkboxes técnicos (cloud, frameworks, bancos vetoriais, etc.)
    await this.handleCheckboxGroups(twin, filled);

    // Diversidade/EEOC
    await this.handleDiversityFields(filled);

    // ── Log completo dos campos preenchidos ──────────────────────────────────
    console.log(`[Greenhouse] ${Object.keys(filled).length} campo(s) preenchido(s):`);
    for (const [field, value] of Object.entries(filled)) {
      console.log(`  [${field}] → "${String(value).slice(0, 80)}"`);
      // Repassa para o QuestionnaireLogger via callback — aparece no dashboard
      options.onFieldFilled?.(field, String(value));
    }

    // ── Verifica campos obrigatórios vazios ──────────────────────────────────
    const missing = await this.checkRequiredFields();
    if (missing.length > 0) {
      console.warn(`[Greenhouse] ⚠ Obrigatórios vazios: ${missing.join(', ')}`);
    }

    if (dryRun) {
      console.log('[Greenhouse] DRY RUN — formulário não submetido.');
      return true;
    }

    return this.submit();
  }

  // ── Campos padrão do Greenhouse ───────────────────────────────────────────

  private async fillStandardFields(twin: CandidateTwin, filled: Record<string, string>): Promise<void> {
    const nameParts = twin.identity.name.split(' ');
    const firstName = nameParts[0];
    const lastName  = nameParts.slice(1).join(' ');

    // Nome e sobrenome
    await this.tryFill(['#first_name', 'input[name="job_application[first_name]"]'], firstName, 'first_name', filled);
    await this.tryFill(['#last_name',  'input[name="job_application[last_name]"]'],  lastName,  'last_name',  filled);

    // Contato
    await this.tryFill(['#email',  'input[name="job_application[email]"]'],  twin.identity.email, 'email', filled);
    await this.tryFill(['#phone',  'input[name="job_application[phone]"]'],  twin.identity.phone, 'phone', filled);

    // LinkedIn
    await this.fillByLabel(/linkedin/i, twin.identity.linkedin, 'linkedin', filled);

    // Cargo/título atual
    const titleLabel = /cargo atual|current (title|position|role)|t[íi]tulo atual/i;
    await this.fillByLabel(titleLabel, twin.professional.currentTitle, 'current_title', filled);

    // Empresa atual
    const companyLabel = /empresa atual|current (company|employer)|empregador/i;
    const currentCompany = twin.history[0]?.company ?? '';
    if (currentCompany) await this.fillByLabel(companyLabel, currentCompany, 'current_company', filled);

    // Salário pretendido — somente números
    const salaryLabel = /pretens[aã]o|salary.*expectation|expected.*salary|desired.*salary|remunera[cç][aã]o/i;
    await this.fillByLabel(salaryLabel, String(twin.financial.targetSalary), 'salary', filled);

    // Website / portfolio
    const webLabel = /website|portfolio|github|site pessoal/i;
    await this.fillByLabel(webLabel, twin.identity.github, 'website', filled);

    // Por onde conheceu (default: LinkedIn)
    const hearLabel = /como (nos |você )?encontrou|como soube|how did you hear|referral|fonte/i;
    await this.fillOrSelectByLabel(hearLabel, 'LinkedIn', 'how_heard', filled);
  }

  // ── Upload de currículo ───────────────────────────────────────────────────

  private async uploadResume(resumePath: string, filled: Record<string, string>): Promise<void> {
    const selectors = [
      'input[type="file"][id*="resume"]',
      'input[type="file"][name*="resume"]',
      'input[type="file"][accept*="pdf"]',
      'input[type="file"]',
    ];

    for (const sel of selectors) {
      const input = this.page.locator(sel).first();
      if (await input.count() === 0) continue;

      try {
        await input.setInputFiles(resumePath);
        await delay(800, 1500);
        filled['resume'] = resumePath;
        console.log(`[Greenhouse] Resume enviado: ${resumePath}`);
        return;
      } catch (err) {
        console.warn(`[Greenhouse] Falha no upload com "${sel}":`, String(err).slice(0, 60));
      }
    }
    console.warn('[Greenhouse] Input de arquivo para resume não encontrado.');
  }

  // ── Perguntas dinâmicas ───────────────────────────────────────────────────

  private async handleDynamicQuestions(
    onQuestion: (q: QuestionnaireQuestion) => Promise<string>,
    filled: Record<string, string>,
  ): Promise<void> {
    const questions = await this.collectDynamicQuestions();

    for (const q of questions) {
      // Pula campos já preenchidos nos padrões de diversidade (tratados em handleDiversityFields)
      if (DIVERSITY_PATTERNS.some(p => p.re.test(q.text))) continue;

      const answer = await onQuestion(q).catch(() => '');
      if (!answer) continue;

      await this.fillField(q, answer).catch(err =>
        console.warn(`[Greenhouse] Erro ao preencher "${q.text.slice(0, 50)}": ${String(err).slice(0, 60)}`),
      );
      filled[`q:${q.text.slice(0, 40)}`] = answer;
      await delay(150, 400);
    }
  }

  private async collectDynamicQuestions(): Promise<QuestionnaireQuestion[]> {
    const questions: QuestionnaireQuestion[] = [];
    const seen = new Set<string>();

    // Texto e textarea
    const textInputs = await this.page.locator(
      'input[type="text"]:not([id*="first_name"]):not([id*="last_name"]):not([id*="email"]):not([id*="phone"]), textarea',
    ).all();

    for (const el of textInputs) {
      const label = await this.getLabelText(el);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      const id = await el.getAttribute('id') ?? `q_${Date.now()}_${Math.random()}`;
      const tag = await el.evaluate((e: Element) => e.tagName.toLowerCase());
      questions.push({ id, text: label, type: tag === 'textarea' ? 'textarea' : 'text', required: await this.isRequired(el) });
    }

    // Selects
    const selects = await this.page.locator('select').all();
    for (const sel of selects) {
      const label = await this.getLabelText(sel);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      const opts = await sel.locator('option').allInnerTexts();
      const id = await sel.getAttribute('id') ?? `q_sel_${Date.now()}`;
      questions.push({ id, text: label, type: 'select', options: opts.filter(o => o.trim()), required: await this.isRequired(sel) });
    }

    // Radio groups
    const fieldsets = await this.page.locator('fieldset').all();
    for (const fs of fieldsets) {
      const legend = (await fs.locator('legend').first().innerText().catch(() => '')).trim();
      if (!legend || seen.has(legend)) continue;
      seen.add(legend);
      const radios = await fs.locator('input[type="radio"]').all();
      if (!radios.length) continue;
      const opts: string[] = [];
      for (const r of radios) {
        const rid = await r.getAttribute('id') ?? '';
        const lbl = rid
          ? (await this.page.locator(`label[for="${rid}"]`).innerText().catch(() => '')).trim()
          : (await r.getAttribute('value') ?? '');
        if (lbl) opts.push(lbl);
      }
      const firstId = await radios[0].getAttribute('id') ?? `q_radio_${Date.now()}`;
      questions.push({ id: firstId, text: legend, type: 'radio', options: opts, required: false });
    }

    return questions;
  }

  // ── Checkboxes técnicos ───────────────────────────────────────────────────

  private async handleCheckboxGroups(twin: CandidateTwin, filled: Record<string, string>): Promise<void> {
    const twinSkills = [
      ...twin.professional.stack,
      ...twin.professional.skills,
    ].map(s => s.toLowerCase());

    // Encontra todos os grupos de checkboxes (div com múltiplos checkboxes)
    const checkboxGroups = await this.page.locator('div:has(input[type="checkbox"])').all();

    for (const group of checkboxGroups) {
      const checkboxes = await group.locator('input[type="checkbox"]').all();
      if (checkboxes.length < 2) continue; // ignora checkboxes isolados (ex: terms of service)

      const groupLabel = await this.getGroupLabel(group);
      const options: { label: string; el: typeof checkboxes[0] }[] = [];

      for (const cb of checkboxes) {
        const cbId = await cb.getAttribute('id') ?? '';
        const cbLabel = cbId
          ? (await this.page.locator(`label[for="${cbId}"]`).innerText().catch(() => '')).trim()
          : (await cb.getAttribute('value') ?? '');
        if (cbLabel) options.push({ label: cbLabel, el: cb });
      }

      if (!options.length) continue;

      // CPU-first: match direto com skills do twin
      const selected: string[] = [];
      for (const opt of options) {
        const lower = opt.label.toLowerCase();
        const isMatch = twinSkills.some(s => lower.includes(s) || s.includes(lower.split(/\s/)[0]));

        // Fallback: verifica no mapa de tech
        const inMap = Object.values(TECH_CHECKBOX_MAP).flat().some(k => lower.includes(k));

        if (isMatch || inMap) {
          if (!(await opt.el.isChecked().catch(() => false))) {
            await opt.el.check({ force: true }).catch(() => {});
          }
          selected.push(opt.label);
        }
      }

      // Se CPU não marcou nada E há API key → pede ao Haiku
      if (!selected.length && process.env.ANTHROPIC_API_KEY) {
        const aiSelected = await this.askHaikuCheckboxes(groupLabel, options.map(o => o.label), twin);
        for (const opt of options) {
          if (aiSelected.includes(opt.label)) {
            await opt.el.check({ force: true }).catch(() => {});
            selected.push(opt.label);
          }
        }
      }

      if (selected.length) {
        filled[`checkbox:${groupLabel.slice(0, 40)}`] = selected.join(', ');
        await delay(100, 300);
      }
    }
  }

  private async askHaikuCheckboxes(
    groupLabel: string,
    options: string[],
    twin: CandidateTwin,
  ): Promise<string[]> {
    const stackCtx = [...twin.professional.stack, ...twin.professional.skills].join(', ');

    // Recupera trechos do vault relevantes para a pergunta (currículo real, não apenas o twin)
    let vaultCtx = '';
    try {
      const chunks = this.retriever.retrieve(groupLabel, 5);
      if (chunks.length > 0) {
        vaultCtx = '\n\nTrecho do currículo/vault relevante:\n' +
          chunks.map(c => `[${c.source} › ${c.section}]\n${c.content}`).join('\n---\n');
      }
    } catch { /* retriever não inicializado — segue sem vault */ }

    try {
      const r = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 250,
        messages: [{
          role: 'user',
          content: `Candidato: ${twin.identity.name} — ${twin.professional.currentTitle} (${twin.professional.yearsExp} anos de exp.)
Stack/skills declarados: ${stackCtx}${vaultCtx}

Pergunta do formulário: "${groupLabel}"
Opções disponíveis: ${options.join(', ')}

Com base EXCLUSIVAMENTE no perfil e currículo acima, quais opções se aplicam ao candidato?
Retorne APENAS os nomes exatos das opções separados por |. Se nenhuma se aplicar, retorne NENHUMA.
Não invente experiências que não estão descritas no currículo.`,
        }],
      });
      const text = r.content[0].type === 'text' ? r.content[0].text.trim() : '';
      if (!text || text.toUpperCase() === 'NENHUMA') return [];
      return text.split('|').map(s => s.trim()).filter(s => options.includes(s));
    } catch {
      return [];
    }
  }

  // ── Diversidade / EEOC ───────────────────────────────────────────────────

  private async handleDiversityFields(filled: Record<string, string>): Promise<void> {
    for (const { re, value } of DIVERSITY_PATTERNS) {
      const val = value();

      // Tenta select com label matching
      const selects = await this.page.locator('select').all();
      for (const sel of selects) {
        const label = await this.getLabelText(sel);
        if (!label || !re.test(label)) continue;
        await this.selectOption(sel, val).catch(() => {});
        filled[`diversity:${label.slice(0, 40)}`] = val;
      }

      // Tenta radio com legend matching
      const fieldsets = await this.page.locator('fieldset').all();
      for (const fs of fieldsets) {
        const legend = (await fs.locator('legend').first().innerText().catch(() => '')).trim();
        if (!legend || !re.test(legend)) continue;
        await this.clickRadioByValue(fs, val).catch(() => {});
        filled[`diversity:${legend.slice(0, 40)}`] = val;
      }
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  private async submit(): Promise<boolean> {
    const submitSelectors = [
      'input[type="submit"]',
      'button[type="submit"]',
      'button:has-text("Submit Application")',
      'button:has-text("Enviar candidatura")',
      'button:has-text("Apply Now")',
      'button:has-text("Submit")',
    ];

    for (const sel of submitSelectors) {
      const btn = this.page.locator(sel).first();
      if (await btn.count() === 0) continue;
      if (!(await btn.isEnabled().catch(() => false))) continue;

      await btn.click({ timeout: 5000 }).catch(async () => btn.dispatchEvent('click'));
      await delay(2500, 4000);

      const url = this.page.url();
      const body = await this.page.locator('body').innerText().catch(() => '');

      const confirmed =
        url.includes('confirmation') ||
        url.includes('submitted') ||
        url.includes('thank') ||
        /thank you|obrigado|candid|submitted|application received/i.test(body);

      if (confirmed) {
        console.log('[Greenhouse] ✅ Candidatura submetida com sucesso.');
        return true;
      }

      console.warn('[Greenhouse] Submit clicado mas confirmação não detectada.');
      return false;
    }

    console.warn('[Greenhouse] Botão de submit não encontrado.');
    return false;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async tryFill(
    selectors: string[],
    value: string,
    key: string,
    filled: Record<string, string>,
  ): Promise<boolean> {
    for (const sel of selectors) {
      const el = this.page.locator(sel).first();
      if (await el.count() === 0) continue;
      try {
        await el.fill(value, { timeout: 4000 });
        filled[key] = value;
        return true;
      } catch {}
    }
    return false;
  }

  private async fillByLabel(
    pattern: RegExp,
    value: string,
    key: string,
    filled: Record<string, string>,
  ): Promise<void> {
    if (!value) return;
    const inputs = await this.page.locator('input[type="text"], input[type="url"], input[type="email"], textarea').all();
    for (const el of inputs) {
      const label = await this.getLabelText(el);
      if (!label || !pattern.test(label)) continue;
      await el.fill(value, { timeout: 4000 }).catch(() => {});
      filled[key] = value;
      return;
    }
  }

  private async fillOrSelectByLabel(
    pattern: RegExp,
    value: string,
    key: string,
    filled: Record<string, string>,
  ): Promise<void> {
    // Try text input first
    await this.fillByLabel(pattern, value, key, filled);
    if (filled[key]) return;

    // Then select
    const selects = await this.page.locator('select').all();
    for (const sel of selects) {
      const label = await this.getLabelText(sel);
      if (!label || !pattern.test(label)) continue;
      await this.selectOption(sel, value).catch(() => {});
      filled[key] = value;
      return;
    }
  }

  private async fillField(q: QuestionnaireQuestion, value: string): Promise<void> {
    if (q.type === 'text' || q.type === 'textarea') {
      const el = this.page.locator(`#${q.id}`).first();
      if (await el.count() > 0) await el.fill(value, { timeout: 5000 });
    } else if (q.type === 'select') {
      const sel = this.page.locator(`#${q.id}`).first();
      await this.selectOption(sel, value).catch(() => {});
    } else if (q.type === 'radio') {
      const fs = this.page.locator(`fieldset:has(legend:text-is("${q.text}"))`).first();
      if (await fs.count() > 0) await this.clickRadioByValue(fs, value).catch(() => {});
    }
  }

  private async selectOption(sel: ReturnType<Page['locator']>, value: string): Promise<void> {
    // Try by label then by value then by partial match
    const ok = await sel.selectOption({ label: value }, { timeout: 3000 }).then(() => true).catch(() => false);
    if (ok) return;
    await sel.selectOption(value, { timeout: 3000 }).catch(async () => {
      const opts = await sel.locator('option').all();
      for (const opt of opts) {
        const txt = (await opt.innerText().catch(() => '')).trim();
        if (txt.toLowerCase().includes(value.toLowerCase().slice(0, 6))) {
          await sel.selectOption({ label: txt }, { timeout: 2000 }).catch(() => {});
          return;
        }
      }
    });
  }

  private async clickRadioByValue(fs: ReturnType<Page['locator']>, value: string): Promise<void> {
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const labels = await fs.locator('label').all();
    for (const lbl of labels) {
      const txt = await lbl.innerText().catch(() => '');
      if (norm(txt).includes(norm(value).slice(0, 8))) {
        await lbl.click({ force: true, timeout: 3000 }).catch(() => {});
        return;
      }
    }
    // Fallback: click radio by value attribute
    const radio = fs.locator(`input[type="radio"]`).filter({ hasText: value }).first();
    if (await radio.count() > 0) await radio.click({ force: true }).catch(() => {});
  }

  private async getLabelText(el: ReturnType<Page['locator']>): Promise<string | null> {
    try {
      const id = await el.getAttribute('id');
      if (id) {
        const lbl = this.page.locator(`label[for="${id}"]`);
        if (await lbl.count() > 0) return (await lbl.first().innerText()).trim();
      }
      // aria-label fallback
      const aria = await el.getAttribute('aria-label');
      if (aria) return aria.trim();
      // placeholder fallback
      const placeholder = await el.getAttribute('placeholder');
      if (placeholder) return placeholder.trim();
      return null;
    } catch {
      return null;
    }
  }

  private async getGroupLabel(group: ReturnType<Page['locator']>): Promise<string> {
    try {
      // Legend within the group
      const legend = group.locator('legend, label.form-label, .field-label, [class*="label"]').first();
      if (await legend.count() > 0) return (await legend.innerText()).trim();
      // aria-label on the group container
      const aria = await group.getAttribute('aria-label');
      if (aria) return aria;
      return 'Campo técnico';
    } catch {
      return 'Campo técnico';
    }
  }

  private async isRequired(el: ReturnType<Page['locator']>): Promise<boolean> {
    const req = await el.getAttribute('required').catch(() => null);
    const aria = await el.getAttribute('aria-required').catch(() => null);
    return req !== null || aria === 'true';
  }

  private async checkRequiredFields(): Promise<string[]> {
    const missing: string[] = [];
    const required = await this.page.locator(
      'input[required]:not([type="file"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), ' +
      'textarea[required], select[required]',
    ).all();

    for (const el of required) {
      const value = await el.inputValue().catch(() => '');
      if (!value.trim()) {
        const label = await this.getLabelText(el);
        missing.push(label ?? await el.getAttribute('id') ?? '?');
      }
    }

    return missing;
  }
}
