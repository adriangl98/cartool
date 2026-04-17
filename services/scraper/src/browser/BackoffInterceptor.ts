export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
}

/**
 * Custom error class for retryable HTTP errors (429, Cloudflare challenges).
 */
export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "RetryableError";
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof RetryableError) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("429") ||
      msg.includes("too many requests") ||
      msg.includes("cf-browser-verification") ||
      msg.includes("cloudflare") ||
      msg.includes("challenge")
    );
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps an async operation with exponential back-off retry logic.
 *
 * Retries on HTTP 429 or Cloudflare challenge responses up to `maxRetries`
 * times with delays of baseDelay × 2^attempt (8s → 16s → 32s by default).
 *
 * Non-retryable errors are thrown immediately without retry.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 8000;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isRetryable(error)) {
        throw error;
      }

      if (attempt >= maxRetries) {
        break;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt);
      console.log(
        JSON.stringify({
          level: "warn",
          message: "Retry attempt",
          attempt: attempt + 1,
          delayMs,
          reason: error instanceof Error ? error.message : String(error),
        })
      );

      await delay(delayMs);
    }
  }

  throw lastError;
}
