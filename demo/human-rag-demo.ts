/**
 * Human RAG Demo — VRAXIA / ai-cognitive-runtime
 *
 * Demonstra o conceito de Human RAG em ~2 minutos.
 * Requer apenas: ANTHROPIC_API_KEY no .env
 *
 * npx tsx demo/human-rag-demo.ts
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Load .env
try {
  const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch { /* ignore */ }

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const COLORS = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m',
  purple: '\x1b[35m', blue: '\x1b[34m', red: '\x1b[31m',
};

const c = (color: keyof typeof COLORS, text: string) =>
  `${COLORS[color]}${text}${COLORS.reset}`;

function print(text: string) { process.stdout.write(text + '\n'); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── HUMAN RAG CORE CONCEPT ──────────────────────────────────────────────────
//
// Traditional RAG: indexes WHAT was written (documents)
// Human RAG:       indexes HOW someone thinks and decides (reasoning patterns)
//
// Step 1: CAPTURE  — extract decision patterns from expert's responses
// Step 2: INDEX    — store as structured reasoning artifacts (not raw text)
// Step 3: RETRIEVE — reconstruct the expert's reasoning for new problems
// Step 4: APPLY    — use reconstructed reasoning to solve similar problems
// ─────────────────────────────────────────────────────────────────────────────

interface ReasoningPattern {
  domain: string;
  trigger: string;
  pattern: string;
  decision_rules: string[];
  captured_at: string;
}

// STEP 1: Simulate capturing an expert's reasoning on a real decision
async function captureExpertReasoning(): Promise<ReasoningPattern> {
  print(c('purple', '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  print(c('bold', '  HUMAN RAG DEMO — VRAXIA AI OS'));
  print(c('dim', '  Preservando inteligência organizacional com IA'));
  print(c('purple', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  print(c('cyan', '📡 PASSO 1: Capturando padrão de raciocínio do especialista...'));
  print(c('dim', '   Cenário: CTO decide se adota nova IA num produto crítico\n'));

  await sleep(500);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system: `Você é um CTO experiente de fintech com 15 anos de experiência.
Você tem um padrão muito específico de avaliação de riscos tecnológicos.
Responda de forma natural, revelando SEU raciocínio e critérios implícitos.`,
    messages: [{
      role: 'user',
      content: 'Nossa equipe quer usar um novo modelo de IA generativa no motor de antifraude. Como você pensa sobre isso?'
    }]
  });

  const expertResponse = (response.content[0] as { text: string }).text;
  print(c('green', '💬 Resposta do especialista capturada'));

  // STEP 2: Extract the reasoning PATTERN (not just the text)
  print(c('cyan', '\n🧠 PASSO 2: Indexando padrão de raciocínio (Human RAG)...'));

  const patternResponse = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system: `Você é um sistema de extração de padrões cognitivos.
Analise a resposta de um especialista e extraia o PADRÃO DE RACIOCÍNIO subjacente —
não o que ele disse, mas COMO ele pensa e quais são suas regras de decisão implícitas.
Responda em JSON.`,
    messages: [{
      role: 'user',
      content: `Resposta do especialista:\n${expertResponse}\n\nExtraia o padrão de raciocínio no formato:\n{"domain":"...","trigger":"...","pattern":"...","decision_rules":["...","...","..."]}`
    }]
  });

  let pattern: ReasoningPattern;
  try {
    const raw = (patternResponse.content[0] as { text: string }).text;
    const jsonMatch = raw.match(/\{[\s\S]+\}/);
    pattern = {
      ...JSON.parse(jsonMatch?.[0] ?? '{}'),
      captured_at: new Date().toISOString()
    };
  } catch {
    pattern = {
      domain: 'technology-risk',
      trigger: 'AI adoption in critical systems',
      pattern: 'Risk-first evaluation with staged rollout preference',
      decision_rules: ['Validate in shadow mode first', 'Require explainability', 'Define rollback criteria'],
      captured_at: new Date().toISOString()
    };
  }

  print(c('green', '✅ Padrão indexado no Human RAG:\n'));
  print(c('yellow', `   Domínio: ${pattern.domain}`));
  print(c('yellow', `   Gatilho: ${pattern.trigger}`));
  print(c('yellow', `   Padrão:  ${pattern.pattern}`));
  print(c('yellow', '   Regras de decisão:'));
  pattern.decision_rules?.forEach(rule => print(c('dim', `     → ${rule}`)));

  return pattern;
}

// STEP 3 + 4: Retrieve pattern and apply to a NEW problem the expert never saw
async function applyRetrievedReasoning(pattern: ReasoningPattern) {
  print(c('cyan', '\n🔍 PASSO 3: Recuperando padrão para problema novo...'));
  print(c('dim', '   Problema: startup sem o CTO original — novo contexto, mesma decisão\n'));

  await sleep(500);

  const applied = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system: `Você é um sistema de reconstrução cognitiva.
Use o padrão de raciocínio indexado de um especialista para resolver
um novo problema como SE o especialista estivesse presente.
Este é o núcleo do Human RAG — preservar COMO a pessoa pensa, não apenas O QUE disse.`,
    messages: [{
      role: 'user',
      content: `PADRÃO DE RACIOCÍNIO DO ESPECIALISTA:
Domínio: ${pattern.domain}
Padrão: ${pattern.pattern}
Regras de decisão: ${pattern.decision_rules?.join(' | ')}

NOVO PROBLEMA (o especialista nunca viu este):
A empresa está avaliando substituir o motor de recomendações de produtos
por um LLM. O especialista não está mais disponível.
Como ele decidiria? Reconstrua o raciocínio dele.`
    }]
  });

  print(c('purple', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  print(c('bold', '  PASSO 4: Raciocínio reconstruído via Human RAG\n'));
  print((applied.content[0] as { text: string }).text);
  print(c('purple', '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
}

function printSummary() {
  print(c('bold', '\n  O que aconteceu nesta demo:\n'));
  print(c('green', '  ✅ Capturou') + ' o raciocínio de um especialista em tempo real');
  print(c('green', '  ✅ Indexou ') + ' o PADRÃO de decisão (não o texto)');
  print(c('green', '  ✅ Recuperou') + ' esse padrão para um problema completamente novo');
  print(c('green', '  ✅ Reconstruiu') + ' como o especialista decidiria — sem ele presente\n');

  print(c('dim',  '  Isso é Human RAG. RAG tradicional teria retornado documentos.'));
  print(c('dim',  '  Human RAG retorna inteligência.\n'));

  print(c('cyan', '  📖 Livro: https://a.co/d/0dTw8I9Y'));
  print(c('cyan', '  🌐 VRAXIA: github.com/SAMIRRICARDO/ai-cognitive-runtime\n'));
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    print(c('red', '\n[ERRO] ANTHROPIC_API_KEY não encontrada.'));
    print(c('dim', 'Adicione ao .env: ANTHROPIC_API_KEY=sk-ant-...\n'));
    process.exit(1);
  }

  try {
    const pattern = await captureExpertReasoning();
    await applyRetrievedReasoning(pattern);
    printSummary();
  } catch (err) {
    print(c('red', `\n[ERRO] ${err instanceof Error ? err.message : err}`));
    process.exit(1);
  }
}

main();
