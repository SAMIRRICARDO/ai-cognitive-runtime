import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../config/env.js";
import { Models, ModelConfig, getMaxTokens, getMaxIterations } from "../../config/models.js";
import { logger } from "../../config/logger.js";
import { modelRouter } from "./router.js";
import { ResponseCache } from "./cache.js";
import { estimateTokens, compressContext } from "./context.js";
import { calculateCost, recordCost, formatCost } from "../../config/costs.js";
import { MemoryManager } from "../../memory/manager.js";
import { buildLocalContext } from "../../memory/local-rag.js";
import { recordAnalytics } from "../../memory/analytics.js";
import { getIALeadsCache } from "../../memory/sqlite-cache.js";
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
  private responseCache: ResponseCache;
  private agentMemory: MemoryManager;

  constructor(config: AgentConfig) {
    // BYOK: use tenant API key when provided, else fall back to global env
    const apiKey = config.tenantEnv?.ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY;
    this.client = new Anthropic({ apiKey });

    this.config = {
      model: Models.default,
      maxTokens: getMaxTokens(),
      temperature: ModelConfig.temperature.balanced,
      maxIterations: getMaxIterations(),
      contextTokenLimit: DEFAULT_CONTEXT_TOKEN_LIMIT,
      enableResponseCache: false,
      ...config,
    };

    // Scoped Redis cache and memory — isolated per tenant when tenantId is set
    const ns = config.tenantId ? `t:${config.tenantId}` : "";
    this.responseCache = new ResponseCache(ns);
    this.agentMemory = new MemoryManager(config.tenantId ?? "default");
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
      const cacheKey = this.responseCache.key(resolvedModel, this.config.systemPrompt, userMessage);
      const cached = await this.responseCache.get(cacheKey);
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
    const localContext = buildLocalContext(userMessage, ["prompts", "campaigns", "companies", "logs"], 4);
    if (localContext) {
      effectiveSystemPrompt += localContext;
      memoriesLoaded += (localContext.match(/^- /gm) ?? []).length;
    }

    const sqliteCache = getIALeadsCache();
    const sqlitePromptKind = `agent:${this.config.name}:${resolvedModel}`;
    const canUseSqlitePromptCache = (this.config.tools ?? []).length === 0;
    if (canUseSqlitePromptCache) {
      const cached = sqliteCache.getPrompt(sqlitePromptKind, userMessage);
      if (cached) {
        logger.info(`[${this.config.name}] sqlite prompt cache hit`, { kind: sqlitePromptKind });
        recordAnalytics({
          provider: "cache",
          source: this.config.name,
          cacheHits: 1,
          estimatedSavingsUsd: 0.002,
          metadata: { kind: sqlitePromptKind },
        });
        return {
          output: typeof cached.response === "string" ? cached.response : JSON.stringify(cached.response),
          usage: totalUsage,
          fromCache: true,
          routing: routingDecision,
          iterations: 0,
          durationMs: Date.now() - startTime,
        };
      }
    }

    if (this.config.memoryEnabled) {
      try {
        await this.agentMemory.initialize();
        const memContext = await this.agentMemory.getContextFor(this.config.name, userMessage);
        if (memContext) {
          effectiveSystemPrompt = effectiveSystemPrompt + memContext;
          memoriesLoaded = (memContext.match(/^- /gm) ?? []).length;
          this.emit(options.onStep, { type: "thinking", content: `[memory] loaded ${memoriesLoaded} relevant memories` });
        }
      } catch (err) {
        logger.warn(`[${this.config.name}] memory load failed`, { err });
      }
    }

    logger.info(`[${this.config.name}] starting run`, { model: resolvedModel, sessionId: options.sessionId, tenantId: this.config.tenantId });

    let messages: MessageParam[] = [{ role: "user", content: userMessage }];

    // 4. Agentic loop
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

    // 5. Cost tracking — scoped per tenant so costs are isolated
    const costKey = this.config.tenantId
      ? `${this.config.tenantId}:${this.config.name}`
      : this.config.name;
    const costBreakdown = calculateCost(resolvedModel, totalUsage);
    await recordCost(costKey, resolvedModel, totalUsage, costBreakdown);
    recordAnalytics({
      provider: "claude",
      source: this.config.name,
      model: resolvedModel,
      inputTokens: totalUsage.inputTokens,
      outputTokens: totalUsage.outputTokens,
      estimatedCostUsd: costBreakdown.totalCost,
      estimatedSavingsUsd: costBreakdown.savings,
      requests: iterations,
      cacheHits: totalUsage.cacheReadTokens > 0 ? 1 : 0,
      metadata: {
        cacheReadTokens: totalUsage.cacheReadTokens,
        cacheCreationTokens: totalUsage.cacheCreationTokens,
        contextCompressed,
      },
    });

    const durationMs = Date.now() - startTime;
    logger.info(`[${this.config.name}] done`, {
      iterations,
      durationMs,
      cost: formatCost(costBreakdown.totalCost),
      savings: formatCost(costBreakdown.savings),
      tenantId: this.config.tenantId,
      ...totalUsage,
    });

    // 6. Store in response cache if enabled and single-turn (no tool use)
    if (this.config.enableResponseCache && iterations === 1 && finalOutput) {
      const cacheKey = this.responseCache.key(resolvedModel, this.config.systemPrompt, userMessage);
      const ttl = this.config.cacheTtl ?? ResponseCache.TTL[routingTier];
      await this.responseCache.set(cacheKey, { output: finalOutput, model: resolvedModel, cachedAt: Date.now() }, ttl);
    }

    if (canUseSqlitePromptCache && finalOutput) {
      sqliteCache.savePrompt({
        kind: sqlitePromptKind,
        prompt: userMessage,
        response: finalOutput,
        metadata: { model: resolvedModel, agent: this.config.name },
      });
    }

    // 7. Save memories from this run (opt-in, non-blocking)
    let memoriesSaved = 0;
    if (this.config.memorySaveEnabled && finalOutput) {
      const { tenantId, tenantEnv } = this.config;
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
