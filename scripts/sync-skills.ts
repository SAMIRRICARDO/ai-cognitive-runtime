/**
 * Copia as skills dos departamentos do Desktop para modules/<dept>/skills/
 *
 * Uso: tsx scripts/sync-skills.ts
 *      tsx scripts/sync-skills.ts --module=financeiro   (só um módulo)
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { module: { type: "string" } },
  strict: false,
});

const BASE =
  "C:\\Users\\Administrador\\Desktop\\VRAXIA SYSTEM\\skills claude diversas\\SKILLS SETORES VRAXIA";

// Mapeamento: moduleId → { pasta com data, nome interno }
const MODULE_MAP: Record<string, { dateFolder: string; innerFolder: string }> = {
  financeiro:   { dateFolder: "Financeiro-20260527T110328Z-3-001",          innerFolder: "Financeiro" },
  juridico:     { dateFolder: "Jurídico & Advocacia-20260527T110331Z-3-001", innerFolder: "Jurídico & Advocacia" },
  marketing:    { dateFolder: "Marketing-20260527T110345Z-3-001",            innerFolder: "Marketing" },
  operacoes:    { dateFolder: "Operações-20260527T110347Z-3-001",            innerFolder: "Operações" },
  conteudo:     { dateFolder: "Conteúdo & Copy-20260527T110235Z-3-001",      innerFolder: "Conteúdo & Copy" },
  lideranca:    { dateFolder: "Liderança & Equipes-20260527T110342Z-3-001",  innerFolder: "Liderança & Equipes" },
  produto:      { dateFolder: "Produto-20260527T110352Z-3-001",              innerFolder: "Produto" },
  codigo:       { dateFolder: "Código-20260527T110231Z-3-001",               innerFolder: "Código" },
  carreira:     { dateFolder: "Carreira-20260527T110227Z-3-001",             innerFolder: "Carreira" },
  design:       { dateFolder: "Design & Branding-20260527T110323Z-3-001",    innerFolder: "Design & Branding" },
  seo:          { dateFolder: "SEO-20260527T110401Z-3-001",                  innerFolder: "SEO" },
  rotina:       { dateFolder: "Rotina-20260527T110354Z-3-001",               innerFolder: "Rotina" },
  "direcao-criativa": { dateFolder: "Direção Criativa-20260527T110326Z-3-001", innerFolder: "Direção Criativa" },
};

const DEST_BASE = path.resolve("modules");

function syncModule(moduleId: string): void {
  const mapping = MODULE_MAP[moduleId];
  if (!mapping) {
    console.error(`Módulo desconhecido: ${moduleId}`);
    return;
  }

  const src = path.join(BASE, mapping.dateFolder, mapping.innerFolder);
  const dest = path.join(DEST_BASE, moduleId, "skills");

  if (!fs.existsSync(src)) {
    console.warn(`  ⚠ Fonte não encontrada: ${src}`);
    return;
  }

  fs.mkdirSync(dest, { recursive: true });

  const files = fs.readdirSync(src).filter((f) => f.endsWith(".md"));
  let copied = 0;

  for (const file of files) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
    copied++;
  }

  console.log(`  ✓ ${moduleId}: ${copied} skills → modules/${moduleId}/skills/`);
}

const targets = typeof values.module === "string"
  ? [values.module]
  : Object.keys(MODULE_MAP);

console.log(`\nSincronizando ${targets.length} módulo(s)...\n`);
for (const m of targets) syncModule(m);
console.log(`\nConcluído.\n`);
