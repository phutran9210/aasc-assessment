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
});
