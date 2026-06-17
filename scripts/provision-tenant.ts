/**
 * CLI para provisionar um novo tenant no VRAXIA SaaS.
 *
 * Uso:
 *   tsx scripts/provision-tenant.ts \
 *     --id=empresa-a \
 *     --name="Empresa A Ltda" \
 *     --plan=professional \
 *     --modules=financeiro,juridico \
 *     --anthropic-key=sk-ant-... \
 *     --openai-key=sk-... \
 *     [--tavily-key=tvly-...] \
 *     [--resend-key=re_...] \
 *     [--resend-from=contato@empresa.com.br]
 */

import { parseArgs } from "node:util";
import { provisionTenant } from "../tenant/provisioner.js";

const { values } = parseArgs({
  options: {
    id:            { type: "string" },
    name:          { type: "string" },
    plan:          { type: "string", default: "starter" },
    modules:       { type: "string", default: "" },
    "anthropic-key": { type: "string" },
    "openai-key":    { type: "string" },
    "tavily-key":    { type: "string" },
    "resend-key":    { type: "string" },
    "resend-from":   { type: "string" },
    "resend-name":   { type: "string" },
    "bcc-email":     { type: "string" },
  },
});

if (!values.id || !values.name || !values["anthropic-key"]) {
  console.error("Required: --id, --name, --anthropic-key");
  process.exit(1);
}

const record = await provisionTenant({
  id: values.id,
  name: values.name,
  plan: (values.plan as any) ?? "starter",
  modules: values.modules ? values.modules.split(",").map(s => s.trim()) : [],
  keys: {
    ANTHROPIC_API_KEY: values["anthropic-key"]!,
    OPENAI_API_KEY:    values["openai-key"],
    TAVILY_API_KEY:    values["tavily-key"],
    RESEND_API_KEY:    values["resend-key"],
    RESEND_FROM_EMAIL: values["resend-from"],
    RESEND_FROM_NAME:  values["resend-name"],
    OUTBOUND_BCC_EMAIL: values["bcc-email"],
  },
});

console.log("\n✅ Tenant provisionado com sucesso!\n");
console.log(`   ID:      ${record.id}`);
console.log(`   Nome:    ${record.name}`);
console.log(`   Plano:   ${record.plan}`);
console.log(`   Módulos: ${record.modules.join(", ") || "(nenhum)"}`);
console.log(`\n   API Key: ${record.apiKey}`);
console.log("\n   Guarde a API Key — ela não será exibida novamente.\n");
