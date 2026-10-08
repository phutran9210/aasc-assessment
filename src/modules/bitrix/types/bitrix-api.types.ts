export type BitrixResult<T> = { result: T; total?: number };

export type BitrixCallOptions = {
  /** Also retry timeouts, network failures and 5xx. Only safe for calls that change nothing. */
  retryTransient?: boolean;
  /** Retries for transient failures; defaults to the rate-limit retry count. */
  maxRetries?: number;
  /** Overrides the default request timeout, for long calls such as `batch`. */
  timeoutMs?: number;
  /** Disable internal QUERY_LIMIT_EXCEEDED retries when an outer worker owns retry policy. */
  retryRateLimit?: boolean;
};
