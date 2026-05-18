import { logger } from "../config/logger.js";
import type { BaseAgent } from "../agents/_base/agent.js";

export interface EvalCase {
  id: string;
  input: string;
  expectedKeywords?: string[];
  customCheck?: (output: string) => boolean;
}

export interface EvalResult {
  id: string;
  passed: boolean;
  output: string;
  durationMs: number;
  reason?: string;
}

export async function runEvals(agent: BaseAgent, cases: EvalCase[]): Promise<void> {
  const results: EvalResult[] = [];

  for (const evalCase of cases) {
    logger.info(`[eval] Running case: ${evalCase.id}`);
    const start = Date.now();

    try {
      const { output } = await agent.run(evalCase.input);
      const durationMs = Date.now() - start;

      let passed = true;
      let reason: string | undefined;

      if (evalCase.expectedKeywords) {
        const missing = evalCase.expectedKeywords.filter(
          (kw) => !output.toLowerCase().includes(kw.toLowerCase())
        );
        if (missing.length > 0) {
          passed = false;
          reason = `Missing keywords: ${missing.join(", ")}`;
        }
      }

      if (evalCase.customCheck && !evalCase.customCheck(output)) {
        passed = false;
        reason = reason ? `${reason}; custom check failed` : "Custom check failed";
      }

      results.push({ id: evalCase.id, passed, output, durationMs, reason });
    } catch (err: any) {
      results.push({ id: evalCase.id, passed: false, output: "", durationMs: 0, reason: err.message });
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  console.log(`\nEval Results: ${passed}/${total} passed\n`);
  for (const r of results) {
    const icon = r.passed ? "✓" : "✗";
    console.log(`  ${icon} [${r.id}] ${r.durationMs}ms${r.reason ? ` — ${r.reason}` : ""}`);
  }

  if (passed < total) process.exit(1);
}
