import { OperationFailure, RetryPolicy } from '../services/retry-policy.service.js';

describe('RetryPolicy', () => {
  const now = new Date('2026-10-09T00:00:00.000Z');

  it('dead letters a transient failure after the fifth started attempt', () => {
    const policy = new RetryPolicy({ random: () => 0.5 });

    expect(policy.decide(new OperationFailure('transient', 'UPSTREAM_5XX'), 5, now)).toEqual({
      outcome: 'dead_letter',
      errorCode: 'UPSTREAM_5XX',
    });
  });

  it('honors Retry-After as a lower bound for a rate limit response', () => {
    const policy = new RetryPolicy({ random: () => 0 });
    const retryAfterMs = 30_000;

    expect(
      policy.decide(new OperationFailure('rate_limit', 'HTTP_429', { retryAfterMs }), 1, now),
    ).toEqual({
      outcome: 'retry_wait',
      nextAttemptAt: new Date(now.getTime() + retryAfterMs),
      errorCode: 'HTTP_429',
    });
  });

  it('requires reconciliation after an ambiguous remote mutation timeout', () => {
    const policy = new RetryPolicy({ random: () => 0.5 });

    expect(
      policy.decide(new OperationFailure('mutation_timeout', 'REMOTE_TIMEOUT'), 1, now),
    ).toEqual({ outcome: 'reconcile_required', errorCode: 'REMOTE_TIMEOUT' });
  });

  it('quarantines validation failures without retrying', () => {
    const policy = new RetryPolicy({ random: () => 0.5 });

    expect(policy.decide(new OperationFailure('validation', 'INVALID_INPUT'), 1, now)).toEqual({
      outcome: 'quarantined',
      errorCode: 'INVALID_INPUT',
    });
  });

  it('uses bounded exponential backoff with injected jitter', () => {
    const policy = new RetryPolicy({ random: () => 0.5 });

    expect(policy.decide(new OperationFailure('transient', 'TEMPORARY'), 2, now)).toEqual({
      outcome: 'retry_wait',
      nextAttemptAt: new Date(now.getTime() + 4_000),
      errorCode: 'TEMPORARY',
    });
  });

  it('dead letters a retry a handler asked for once the attempt budget is spent', () => {
    const policy = new RetryPolicy({ random: () => 0.5 });
    const requested = {
      outcome: 'retry_wait' as const,
      nextAttemptAt: new Date(now.getTime() + 5_000),
      errorCode: 'LEAD_SYNC_FAILED',
    };

    expect(policy.enforce(requested, 5, now)).toEqual({
      outcome: 'dead_letter',
      errorCode: 'LEAD_SYNC_FAILED',
    });
  });

  it('never retries a handler requested retry sooner than its own backoff', () => {
    const policy = new RetryPolicy({ random: () => 0.5 });
    const requested = (delayMs: number) => ({
      outcome: 'retry_wait' as const,
      nextAttemptAt: new Date(now.getTime() + delayMs),
      errorCode: 'LEAD_SYNC_FAILED',
    });

    expect(policy.enforce(requested(5_000), 4, now)).toEqual(requested(16_000));
    expect(policy.enforce(requested(30_000), 1, now)).toEqual(requested(30_000));
  });

  it('leaves a deferred retry and every other outcome untouched', () => {
    const policy = new RetryPolicy({ random: () => 0.5 });
    const deferred = {
      outcome: 'retry_wait' as const,
      nextAttemptAt: new Date(now.getTime() + 5_000),
      errorCode: 'LEAD_SYNC_LEASE_BUSY',
      deferred: true as const,
    };

    expect(policy.enforce(deferred, 9, now)).toBe(deferred);
    expect(policy.enforce({ outcome: 'succeeded' }, 9, now)).toEqual({ outcome: 'succeeded' });
  });
});
