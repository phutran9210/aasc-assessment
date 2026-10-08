export type OperationFailureKind = 'transient' | 'rate_limit' | 'mutation_timeout' | 'validation';

export type RetryDecision =
  | { outcome: 'retry_wait'; nextAttemptAt: Date; errorCode: string }
  | { outcome: 'reconcile_required'; errorCode: string }
  | { outcome: 'quarantined'; errorCode: string }
  | { outcome: 'dead_letter'; errorCode: string };
