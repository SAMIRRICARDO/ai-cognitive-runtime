// packages/work/src/rag/profile-metrics.ts
// Per-layer observability: hit/miss counters, latency, cache hit rate.

import { DecisionLayer, LayerMetrics, MetricsSnapshot } from './candidate-profile-types.js';

export class ProfileMetrics {
  private counters: Map<DecisionLayer, LayerMetrics> = new Map();
  private totalQuestions = 0;
  private totalLatencyMs = 0;

  constructor() {
    for (const layer of Object.values(DecisionLayer)) {
      this.counters.set(layer as DecisionLayer, { hits: 0, misses: 0, totalLatencyMs: 0 });
    }
  }

  record(layer: DecisionLayer, hit: boolean, latencyMs: number): void {
    const m = this.counters.get(layer)!;
    if (hit) m.hits++; else m.misses++;
    m.totalLatencyMs += latencyMs;
    this.totalQuestions++;
    this.totalLatencyMs += latencyMs;
  }

  snapshot(): MetricsSnapshot {
    const cache = this.counters.get(DecisionLayer.CACHE)!;
    const totalCacheChecks = cache.hits + cache.misses;
    const byLayer: Partial<Record<DecisionLayer, LayerMetrics>> = {};
    for (const [layer, m] of this.counters) {
      if (m.hits + m.misses > 0) byLayer[layer] = { ...m };
    }
    return {
      totalQuestions: this.totalQuestions,
      cacheHitRate: totalCacheChecks > 0 ? cache.hits / totalCacheChecks : 0,
      avgLatencyMs: this.totalQuestions > 0 ? this.totalLatencyMs / this.totalQuestions : 0,
      byLayer,
    };
  }

  reset(): void {
    for (const m of this.counters.values()) {
      m.hits = 0; m.misses = 0; m.totalLatencyMs = 0;
    }
    this.totalQuestions = 0;
    this.totalLatencyMs = 0;
  }
}
