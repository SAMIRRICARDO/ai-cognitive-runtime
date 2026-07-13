// packages/work/src/application/RetryEngine.ts

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs?: number;
  shouldRetry?: (error: Error, attempt: number) => boolean;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 2,
  baseDelayMs: 2000,
  maxDelayMs: 20000,
  jitterMs: 1000,
};

// Erros que indicam possível submit já enviado — NUNCA retente
const SUBMIT_AMBIGUOUS_MESSAGES = [
  'submitting',
  'submitted',
  'já enviou',
  'already applied',
  'você já se candidatou',
];

export function isSubmitAmbiguous(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return SUBMIT_AMBIGUOUS_MESSAGES.some(s => msg.includes(s));
}

export class RetryEngine {
  async retry<T>(
    operation: () => Promise<T>,
    config: RetryConfig,
  ): Promise<T> {
    let lastError: Error = new Error('Unknown error');

    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (config.shouldRetry && !config.shouldRetry(lastError, attempt)) {
          throw lastError;
        }

        if (attempt === config.maxAttempts) break;

        const baseDelay = config.baseDelayMs * Math.pow(2, attempt - 1);
        const jitter = config.jitterMs ? Math.random() * config.jitterMs : 0;
        const delay = Math.min(baseDelay + jitter, config.maxDelayMs);

        config.onRetry?.(attempt, lastError, delay);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    throw lastError;
  }

  backoffMs(attempt: number, base: number, max: number): number {
    return Math.min(base * Math.pow(2, attempt - 1), max);
  }
}
