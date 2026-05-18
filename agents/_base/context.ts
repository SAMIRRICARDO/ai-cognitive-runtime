import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../../config/logger.js";
import { Models } from "../../config/models.js";
import type { MessageParam } from "./types.js";

// Rough token estimator: 1 token ≈ 4 chars
export function estimateTokens(messages: MessageParam[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

const COMPRESSION_PROMPT = `Summarize the following conversation history into a concise paragraph.
Preserve all key decisions, facts, tool results, and conclusions. Omit small talk and repeated information.
Output ONLY the summary — no preamble, no labels.`;

/**
 * Compresses messages that exceed the token budget by summarizing older turns.
 * Always keeps the last `keepRecent` message pairs intact to preserve immediate context.
 */
export async function compressContext(
  client: Anthropic,
  messages: MessageParam[],
  tokenBudget: number,
  keepRecent = 4
): Promise<{ messages: MessageParam[]; compressed: boolean; savedTokens: number }> {
  const before = estimateTokens(messages);

  if (before <= tokenBudget) {
    return { messages, compressed: false, savedTokens: 0 };
  }

  // Split: compress everything except the last `keepRecent` pairs
  const cutoff = Math.max(0, messages.length - keepRecent * 2);
  const toCompress = messages.slice(0, cutoff);
  const toKeep = messages.slice(cutoff);

  if (toCompress.length === 0) {
    logger.warn("[context] cannot compress further — all recent messages are protected");
    return { messages, compressed: false, savedTokens: 0 };
  }

  const historyText = toCompress
    .map((m) => {
      const role = m.role.toUpperCase();
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `${role}: ${content}`;
    })
    .join("\n\n");

  const response = await client.messages.create({
    model: Models.fast,
    max_tokens: 1024,
    system: COMPRESSION_PROMPT,
    messages: [{ role: "user", content: historyText }],
  });

  const summary = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const summaryMessage: MessageParam = {
    role: "user",
    content: `[Conversation history summary]\n${summary}`,
  };

  const compressed: MessageParam[] = [summaryMessage, ...toKeep];
  const after = estimateTokens(compressed);
  const savedTokens = before - after;

  logger.info("[context] compressed", {
    before,
    after,
    savedTokens,
    removedMessages: toCompress.length,
  });

  return { messages: compressed, compressed: true, savedTokens };
}
