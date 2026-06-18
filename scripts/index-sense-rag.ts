/**
 * Indexes VRAXIA Sense architectural documents into the local RAG
 * Collection: "prompts" (architectural knowledge / system specs)
 * Run: npx tsx scripts/index-sense-rag.ts
 */
import fs from "node:fs";
import { saveLocalMemory } from "../memory/local-rag.js";

const SENSE_DIR = "C:/Users/Administrador/Desktop/VRAXIA SYSTEM/VRAXIA SENSE";

const docs = [
  {
    file: "vraxia-sense-resumo.md",
    id: "sense-resumo",
    tags: ["sense", "conceito", "percepcao", "proativo"],
  },
  {
    file: "vraxia-sense-architecture.md",
    id: "sense-architecture",
    tags: ["sense", "arquitetura", "filtros", "triagem", "token-economy"],
  },
  {
    file: "vraxia-sense-comercial.md",
    id: "sense-comercial",
    tags: ["sense", "comercial", "piloto", "waalaxy", "linkedin", "implementation"],
  },
  {
    file: "vraxia-sense-expansao-template.md",
    id: "sense-expansao",
    tags: ["sense", "expansao", "template", "departamentos", "financeiro", "rh"],
  },
  {
    file: "PROMPT-EXECUCAO-claude-code.md",
    id: "sense-prompt-execucao",
    tags: ["sense", "execucao", "implementacao", "checklist"],
  },
];

console.log("📦 Indexando VRAXIA Sense na RAG...\n");

for (const doc of docs) {
  const filePath = `${SENSE_DIR}/${doc.file}`;
  const content = fs.readFileSync(filePath, "utf-8");

  saveLocalMemory({
    collection: "prompts",
    id: doc.id,
    content: content.slice(0, 4000), // cap para não inflar o index
    tags: doc.tags,
    metadata: { source: "vraxia-sense", file: doc.file, type: "architectural-spec" },
  });

  console.log(`  ✓ ${doc.file} (${content.length} chars) → prompts/${doc.id}`);
}

console.log("\n✅ Indexação completa.");

// Teste de busca
const { searchLocalMemory } = await import("../memory/local-rag.js");
const results = searchLocalMemory({ query: "filtro determinístico nivel 0 custo zero", collections: ["prompts"], limit: 2 });
console.log("\n🔍 Teste RAG: 'filtro determinístico nivel 0'");
results.forEach(r => console.log(`  → [${r.id}] score:${r.score} | ${r.content.slice(0, 100)}...`));
