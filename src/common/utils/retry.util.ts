/** Resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with jitter: `baseMs × 2^attempt` plus a random extra below `baseMs`, so
 * several clients that failed together do not retry at the same instant.
 */
export function backoffDelayMs(attempt: number, baseMs: number): number {
  return baseMs * 2 ** attempt + Math.floor(Math.random() * baseMs);
}
