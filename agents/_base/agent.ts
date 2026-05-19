import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../config/env.js";
import { Models, ModelConfig, getMaxTokens, getMaxIterations } from "../../config/models.js";
import { logger } from "../../config/logger.js";
import { modelRouter } from "./router.js";
import { responseCache, ResponseCache } from "./cache.js";
import { estimateTokens, compressContext } from "./context.js";
import { calculateCost, recordCost, formatCost } from "../../config/costs.js";
import { memoryManager } from "../../memory/manager.js";
import type {
  AgentConfig,
  AgentResult,
  AgentRunOptions,
  AgentStep,
  ToolHandler,
  MessageParam,
} from "./types.js";

const DEFAULT_CONTEXT_TOKEN_LIMIT = 80_000;

export abstract class BaseAgent {
  protected client: Anthropic;
  protected config: AgentConfig;
  protected toolHandlers: Map<string, ToolHandler> = new Map();

  constructor(config: AgentConfig) {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    this.config = {
      model: Models.default,
      maxTokens: getMaxTokens(),
      temperature: ModelConfig.temperature.balanced,
      maxIterations: getMaxIterations(),
      contextTokenLimit: DEFAULT_CONTEXT_TOKEN_LIMIT,
      enableResponseCache: false,
      ...config,
    };
  }

  registerTool(handler: ToolHandler): void {
    this.toolHandlers.set(handler.name, handler);
    if (!this.config.tools) this.config.tools = [];
    this.config.tools.push(handler.schema);
  }

  async run(
    userMessage: string,
    options: AgentRunOptions = {}
  ): Promise<AgentResult<string>> {
    const startTime = Date.now();

    let totalUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
    let iterations = 0;
    let finalOutput = "";
    let routingDecision: AgentResult["routing"];
    let contextCompressed = false;
    let memoriesLoaded = 0;

    // 1. Resolve model (auto-routing)
    let resolvedModel = this.config.model!;
    let routingTier: keyof typeof ResponseCache.TTL = "default";

    if (resolvedModel === "auto") {
      const decision = await modelRouter.route(userMessage);
      resolvedModel = decision.model;
      routingTier = decision.tier as keyof typeof ResponseCache.TTL;
      routingDecision = { tier: decision.tier, model: decision.model, score: decision.score, reason: decision.reason };
      logger.info(`[${this.config.name}] routed`, { model: resolvedModel, tier: decision.tier, score: decision.score });
      this.emit(options.onStep, { type: "thinking", content: `[router] ${decision.tier} → ${resolvedModel}` });
    }

    // 2. Response cache check (only for single-turn, no tools in flight)
    if (this.config.enableResponseCache) {
      const cacheKey = responseCache.key(resolvedModel, this.config.systemPrompt, userMessage);
      const cached = await responseCache.get(cacheKey);
      if (cached) {
        logger.info(`[${this.config.name}] cache hit`, { key: cacheKey });
        this.emit(options.onStep, { type: "thinking", content: "[cache] hit — returning cached response" });
        return {
          output: cached.output,
          usage: totalUsage,
          fromCache: true,
          routing: routingDecision,
          iterations: 0,
          durationMs: Date.now() - startTime,
        };
      }
    }

    // 3. Memory injection (opt-in)
    let effectiveSystemPrompt = this.config.systemPrompt;
    if (this.config.memoryEnabled) {
      try {
        await memoryManager.initialize();
        const memContext = await memoryManager.getContextFor(this.config.name, userMessage);
        if (memContext) {
          effectiveSystemPrompt = effectiveSystemPrompt + memContext;
          memoriesLoaded = (memContext.match(/^- /gm) ?? []).length;
          this.emit(options.onStep, { type: "thinking", content: `[memory] loaded ${memoriesLoaded} relevant memories` });
        }
      } catch (err) {
        logger.warn(`[${this.config.name}] memory load failed`, { err });
      }
    }

    logger.info(`[${this.config.name}] starting run`, { model: resolvedModel, sessionId: options.sessionId });

    let messages: MessageParam[] = [{ role: "user", content: userMessage }];

    // 3. Agentic loop
    while (iterations < (this.config.maxIterations ?? 10)) {
      iterations++;

      // Context compression check before each API call
      const estimatedTokens = estimateTokens(messages);
      if (estimatedTokens > (this.config.contextTokenLimit ?? DEFAULT_CONTEXT_TOKEN_LIMIT)) {
        const result = await compressContext(
          this.client,
          messages,
          this.config.contextTokenLimit ?? DEFAULT_CONTEXT_TOKEN_LIMIT
        );
        messages = result.messages;
        if (result.compressed) {
          contextCompressed = true;
          this.emit(options.onStep, {
            type: "thinking",
            content: `[context] compressed — saved ~${result.savedTokens} tokens`,
          });
        }
      }

      const response = await this.client.messages.create({
        model: resolvedModel,
        max_tokens: this.config.maxTokens!,
        system: [
          {
            type: "text",
            text: effectiveSystemPrompt,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: this.config.tools ?? [],
        messages,
      });

      totalUsage.inputTokens        += response.usage.input_tokens;
      totalUsage.outputTokens       += response.usage.output_tokens;
      totalUsage.cacheReadTokens    += (response.usage as any).cache_read_input_tokens ?? 0;
      totalUsage.cacheCreationTokens += (response.usage as any).cache_creation_input_tokens ?? 0;

      for (const block of response.content) {
        if (block.type === "text") {
          finalOutput = block.text;
          this.emit(options.onStep, { type: "output", content: block.text });
        }
      }

      if (response.stop_reason === "end_turn") break;

      if (response.stop_reason === "tool_use") {
        messages.push({ role: "assistant", content: response.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type !== "tool_use") continue;

          const handler = this.toolHandlers.get(block.name);
          this.emit(options.onStep, { type: "tool_call", tool: block.name, input: block.input });

          let result: unknown;
          result = handler
            ? await handler.execute(block.input as Record<string, unknown>)
            : { error: `Unknown tool: ${block.name}` };

          this.emit(options.onStep, { type: "tool_result", tool: block.name, result });
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: typeof result === "string" ? result : JSON.stringify(result),
          });
        }

        messages.push({ role: "user", content: toolResults });
        continue;
      }

      break;
    }

    // 4. Cost tracking
    const costBreakdown = calculateCost(resolvedModel, totalUsage);
    await recordCost(this.config.name, resolvedModel, totalUsage, costBreakdown);

    const durationMs = Date.now() - startTime;
    logger.info(`[${this.config.name}] done`, {
      iterations,
      durationMs,
      cost: formatCost(costBreakdown.totalCost),
      savings: formatCost(costBreakdown.savings),
      ...totalUsage,
    });

    // 5. Store in response cache if enabled and single-turn (no tool use)
    if (this.config.enableResponseCache && iterations === 1 && finalOutput) {
      const cacheKey = responseCache.key(resolvedModel, this.config.systemPrompt, userMessage);
      const ttl = this.config.cacheTtl ?? ResponseCache.TTL[routingTier];
      await responseCache.set(cacheKey, { output: finalOutput, model: resolvedModel, cachedAt: Date.now() }, ttl);
    }

    // 6. Save memories from this run (opt-in, non-blocking)
    let memoriesSaved = 0;
    if (this.config.memorySaveEnabled && finalOutput) {
      // Import lazily to avoid circular dependency with MemoryManagerAgent
      import("../memory-manager/agent.js").then(({ MemoryManagerAgent }) =>
        MemoryManagerAgent.create(this.config.name)
          .then((mgr) => mgr.extractFromRun({ agentName: this.config.name, userMessage, agentOutput: finalOutput }))
          .then((mems) => { memoriesSaved = mems.length; })
          .catch((err) => logger.warn(`[${this.config.name}] memory save failed`, { err }))
      );
    }

    return {
      output: finalOutput,
      usage: totalUsage,
      cost: {
        totalCostUsd: costBreakdown.totalCost,
        savings: costBreakdown.savings,
        breakdown: {
          input: costBreakdown.inputCost,
          output: costBreakdown.outputCost,
          cacheWrite: costBreakdown.cacheWriteCost,
          cacheRead: costBreakdown.cacheReadCost,
        },
      },
      routing: routingDecision,
      fromCache: false,
      contextCompressed,
      memoriesLoaded,
      memoriesSaved,
      iterations,
      durationMs,
    };
  }

  private emit(onStep: AgentRunOptions["onStep"], step: AgentStep): void {
    if (onStep) onStep(step);
  }
}
