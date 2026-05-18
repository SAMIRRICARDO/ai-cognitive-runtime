import { Models } from "./models.js";

export type ComplexityTier = "low" | "medium" | "high";

export interface RoutingDecision {
  model: string;
  tier: ComplexityTier;
  score: number;
  reason: string;
}

export interface ComplexitySignal {
  pattern: RegExp;
  delta: number;
  label: string;
}

// Scoring signals — positive = more complex, negative = less complex
export const COMPLEXITY_SIGNALS: ComplexitySignal[] = [
  // High complexity signals
  { pattern: /\b(architect|design system|scalab|distributed|tradeoff|trade-off)\b/i, delta: 30, label: "architecture" },
  { pattern: /\b(comprehensive|in[- ]depth|exhaustive|thorough|complete analysis)\b/i, delta: 25, label: "depth-request" },
  { pattern: /\b(refactor entire|rewrite|migrate|audit)\b/i, delta: 25, label: "large-scope" },
  { pattern: /\b(security|vulnerabilit|CVE|exploit|penetration)\b/i, delta: 20, label: "security" },
  { pattern: /\b(machine learning|neural|embedding|fine.?tun)\b/i, delta: 20, label: "ml-domain" },
  { pattern: /\b(compare .{0,40} and .{0,40}|versus|pros and cons|tradeoffs)\b/i, delta: 15, label: "comparison" },
  { pattern: /\b(step[- ]by[- ]step|explain in detail|how does .{0,30} work)\b/i, delta: 15, label: "explanation" },
  { pattern: /\b(multi[- ]?agent|orchestrat|workflow|pipeline)\b/i, delta: 15, label: "orchestration" },

  // Medium complexity signals
  { pattern: /\b(implement|create a|build a|write a|develop)\b/i, delta: 10, label: "implementation" },
  { pattern: /\b(debug|fix|resolve|troubleshoot)\b/i, delta: 8, label: "debugging" },
  { pattern: /\b(test|spec|coverage|assert)\b/i, delta: 5, label: "testing" },
  { pattern: /\b(api|endpoint|route|middleware)\b/i, delta: 5, label: "api" },

  // Low complexity signals
  { pattern: /\b(list|enumerate|what is|what are|define|simple|quick|brief)\b/i, delta: -15, label: "simple-query" },
  { pattern: /\b(format|convert|parse|rename|replace)\b/i, delta: -10, label: "transformation" },
  { pattern: /\b(summarize|tldr|summary)\b/i, delta: -8, label: "summarization" },
  { pattern: /\b(translate|spelling|grammar)\b/i, delta: -15, label: "language-task" },
];

export const ROUTING_THRESHOLDS = {
  lowToMedium: 20,   // score >= 20 → medium
  mediumToHigh: 50,  // score >= 50 → high
} as const;

export const TIER_MODELS: Record<ComplexityTier, string> = {
  low: Models.fast,
  medium: Models.default,
  high: Models.powerful,
};
