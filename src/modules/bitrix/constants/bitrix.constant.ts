export const BITRIX_EVENT_NAMES = ['ONAPPINSTALL', 'ONAPPUPDATE'] as const;
export type BitrixEventName = (typeof BITRIX_EVENT_NAMES)[number];

export const BITRIX_REST = {
  OAUTH_TOKEN_URL: 'https://oauth.bitrix.info/oauth/token/',
  ENTITY_TYPE_CONTACT: 3,
  ENTITY_TYPE_REQUISITE: 8,
  ADDRESS_TYPE_PHYSICAL: 1,
} as const;

// Refresh lock: the lease must outlive one token request (10s timeout) so it is not stolen
// mid-flight; waiters re-check the stored token every poll interval.
export const BITRIX_REFRESH_LOCK = {
  LEASE_MS: 30_000,
  POLL_MS: 200,
} as const;

// Bitrix24 request rate limit (non-Enterprise plans): the counter is blocked above 50 and drains
// by 2 per second. BURST stays below 50 to leave room for other integrations on the same IP.
// A call that would queue longer than MAX_WAIT_MS is refused with 429. If Bitrix24 still answers
// QUERY_LIMIT_EXCEEDED, the call is retried after 0.5s, 1s and 2s.
export const BITRIX_RATE_LIMIT = {
  ERROR_CODE: 'QUERY_LIMIT_EXCEEDED',
  BURST: 40,
  DRAIN_PER_SECOND: 2,
  MAX_WAIT_MS: 8_000,
  RETRIES: 3,
  BASE_DELAY_MS: 500,
} as const;
