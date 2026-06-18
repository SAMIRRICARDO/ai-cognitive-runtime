/**
 * classify_linkedin_reply — classifica uma resposta do LinkedIn via pipeline VRAXIA Sense.
 * Nível 1 (triage Haiku ~80 tokens) + Nível 2 (classificação completa ~300 tokens).
 * Envia notificação Telegram se handoff=true.
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";
import type { ToolHandler } from "../agents/_base/types.js";
import { notifyTelegram } from "./telegram.js";

const CLASSIFIER_PROMPT = `Qualificador B2B de respostas LinkedIn. JSON puro, sem markdown.

VARIANTES: A=equipe própria B=agência/parceiro C=híbrido D=baixa frequência E=interesse direto
INTENT: high=pediu info/reunião/dor clara medium=curiosidade leve low=desviou none=fora do ICP

CARGO→DECISION_POWER+SCORE (inferir do campo Cargo):
high 8-10: Diretor, VP, Head, C-Level, CEO, CFO, CTO, Presidente
mid  5-7:  Gerente, Coordenador Sênior, Supervisor
low  1-4:  Analista, Assistente, Estagiário, Coordenador Júnior

HANDOFF true: (intent=high E power=high|mid) OU (intent=medium E power=high)
HANDOFF false: power=low (qualquer intent) OU intent=low|none

{"variant":"A"|"B"|"C"|"D"|"E","intent":"high"|"medium"|"low"|"none","decision_power":"high"|"mid"|"low","score":1-10,"handoff":true|false,"reason":"≤15 palavras","suggested_next_action":"string"}`;

function stripFences(s: string): string {
  return s.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
}

function buildTelegramReport(input: {
  reply: string;
  prospect_name?: string;
  company?: string;
  role?: string;
  linkedin_url?: string;
}, c: Record<string, unknown>): string {
  return `🔔 <b>VRAXIA SENSE — LEAD DETECTADO (via Chat Comercial)</b>

👤 <b>${input.prospect_name || "—"}</b>
💼 ${input.role || "—"}
🏢 ${input.company || "—"}
${input.linkedin_url ? `🔗 ${input.linkedin_url}` : ""}

💬 <b>Resposta recebida:</b>
<i>"${input.reply}"</i>

🧠 <b>Análise IA:</b>
Perfil: <b>${c.variant}</b> | Intent: <b>${String(c.intent).toUpperCase()}</b> | Score: <b>${c.score}/10</b>
${c.reason}

▶️ <b>Próximo passo:</b>
${c.suggested_next_action}

<code>VRAXIA Sense · Chat · ${new Date().toLocaleString("pt-BR")}</code>`.trim();
}

export const classifyLinkedInReplyTool: ToolHandler = {
  name: "classify_linkedin_reply",
  schema: {
    name: "classify_linkedin_reply",
    description:
      "Classifica uma resposta recebida no LinkedIn via pipeline VRAXIA Sense. " +
      "Detecta intent, decision power, score 1-10 e próximo passo recomendado. " +
      "Se handoff=true, envia alerta automático no Telegram. " +
      "Use quando o usuário colar uma mensagem/resposta do LinkedIn para análise.",
    input_schema: {
      type: "object" as const,
      properties: {
        reply: {
          type: "string",
          description: "Texto da resposta recebida no LinkedIn",
        },
        prospect_name: {
          type: "string",
          description: "Nome do prospecto que respondeu (opcional)",
        },
        company: {
          type: "string",
          description: "Empresa do prospecto (opcional)",
        },
        role: {
          type: "string",
          description: "Cargo do prospecto (opcional — melhora precisão do score)",
        },
        linkedin_url: {
          type: "string",
          description: "URL do perfil LinkedIn (opcional)",
        },
        notify_telegram: {
          type: "boolean",
          description: "Se true e handoff=true, envia notificação no Telegram. Padrão: true.",
        },
      },
      required: ["reply"],
    },
  },

  execute: async (raw) => {
    const input = raw as {
      reply: string;
      prospect_name?: string;
      company?: string;
      role?: string;
      linkedin_url?: string;
      notify_telegram?: boolean;
    };

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: CLASSIFIER_PROMPT,
      messages: [
        {
          role: "user",
          content: `Decisor: ${input.prospect_name || "Desconhecido"} | Cargo: ${input.role || "—"} | Empresa: ${input.company || "—"}\nResposta: "${input.reply}"`,
        },
      ],
    });

    const rawText = response.content[0].type === "text" ? response.content[0].text : "{}";

    let classification: Record<string, unknown>;
    try {
      classification = JSON.parse(stripFences(rawText));
    } catch {
      return { error: "Falha ao parsear classificação", raw: rawText };
    }

    const shouldNotify = (input.notify_telegram ?? true) && classification.handoff === true;
    let telegramSent = false;

    if (shouldNotify) {
      try {
        await notifyTelegram(buildTelegramReport(input, classification));
        telegramSent = true;
      } catch {
        // Telegram failure does not block the classification result
      }
    }

    return {
      prospect: input.prospect_name || "—",
      company: input.company || "—",
      role: input.role || "—",
      variant: classification.variant,
      intent: classification.intent,
      decision_power: classification.decision_power,
      score: classification.score,
      handoff: classification.handoff,
      reason: classification.reason,
      suggested_next_action: classification.suggested_next_action,
      telegram_sent: telegramSent,
    };
  },
};
