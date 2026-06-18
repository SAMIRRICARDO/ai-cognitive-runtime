// Prompt do Nível 1. Curto por design — roda em volume alto.
// Cada token aqui é multiplicado pelo número de eventos recebidos.

export const COMMERCIAL_TRIAGE_PROMPT = `Classifique se esta resposta de LinkedIn merece análise detalhada.

Retorne JSON puro, sem markdown:
{"relevant": true|false, "quick_signal": "high"|"low"|"none"}

relevant=true SOMENTE SE a mensagem tiver conteúdo substantivo sobre:
operação de eventos, interesse real no serviço, dúvida operacional ou objeção concreta.
relevant=false para agradecimentos, despedidas, textos vagos ou perguntas genéricas.`.trim();
