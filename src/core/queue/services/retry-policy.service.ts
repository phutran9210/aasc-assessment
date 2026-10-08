export type OperationFailureKind = 'transient' | 'rate_limit' | 'mutation_timeout' | 'validation';

export class OperationFailure extends Error {
  constructor(
    readonly kind: OperationFailureKind,
    readonly code: string,
    readonly options: { retryAfterMs?: number; detail?: string } = {},
  ) {
    super(options.detail ?? code);
    this.name = 'OperationFailure';
  }
}

export type RetryDecision =
  | { outcome: 'retry_wait'; nextAttemptAt: Date; errorCode: string }
  | { outcome: 'reconcile_required'; errorCode: string }
  | { outcome: 'quarantined'; errorCode: string }
  | { outcome: 'dead_letter'; errorCode: string };

export class RetryPolicy {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly random: () => number;

  constructor(
    options: {
      maxAttempts?: number;
      baseDelayMs?: number;
      maxDelayMs?: number;
      random?: () => number;
    } = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 2_000;
    this.maxDelayMs = options.maxDelayMs ?? 60_000;
    this.random = options.random ?? Math.random;
  }

  decide(error: OperationFailure, attempt: number, now: Date): RetryDecision {
    if (!Number.isSafeInteger(attempt) || attempt < 1) {
      throw new RangeError('attempt must be a positive integer');
    }
    if (!Number.isFinite(now.getTime())) throw new RangeError('now must be a valid date');
    if (error.kind === 'validation') return { outcome: 'quarantined', errorCode: error.code };
    if (error.kind === 'mutation_timeout') {
      return { outcome: 'reconcile_required', errorCode: error.code };
    }
    if (attempt >= this.maxAttempts) return { outcome: 'dead_letter', errorCode: error.code };

    const exponential = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (attempt - 1));
    const jitter = this.clampRandom(this.random());
    const jittered = Math.round(exponential * (0.5 + jitter));
    const delayMs = Math.min(this.maxDelayMs, jittered);
    const suppliedRetryAfter = error.kind === 'rate_limit' ? (error.options.retryAfterMs ?? 0) : 0;
    const retryAfterMs = Number.isFinite(suppliedRetryAfter) ? Math.max(0, suppliedRetryAfter) : 0;
    return {
      outcome: 'retry_wait',
      nextAttemptAt: new Date(now.getTime() + Math.max(delayMs, retryAfterMs)),
      errorCode: error.code,
    };
  }

  private clampRandom(value: number): number {
    if (!Number.isFinite(value)) return 0.5;
    return Math.min(1, Math.max(0, value));
  }
}
