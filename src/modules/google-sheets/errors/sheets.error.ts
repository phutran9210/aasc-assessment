import { GOOGLE_SHEETS_MESSAGES } from '../messages/index.js';

export type SheetsErrorKind =
  'config' | 'auth' | 'not_found' | 'invalid' | 'rate_limit' | 'timeout' | 'network' | 'upstream';

const RETRYABLE: readonly SheetsErrorKind[] = ['rate_limit', 'timeout', 'network', 'upstream'];

/** A failed Google call. `kind` tells the caller how to react; `detail` is Google's own text. */
export class SheetsError extends Error {
  constructor(
    message: string,
    readonly kind: SheetsErrorKind,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'SheetsError';
  }

  get retryable(): boolean {
    return RETRYABLE.includes(this.kind);
  }
}

type UpstreamError = {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  response?: { status?: unknown };
};

const { ERROR } = GOOGLE_SHEETS_MESSAGES;

const MESSAGE_BY_KIND: Record<Exclude<SheetsErrorKind, 'config'>, string> = {
  auth: ERROR.AUTH,
  not_found: ERROR.NOT_FOUND,
  invalid: ERROR.INVALID,
  rate_limit: ERROR.RATE_LIMIT,
  timeout: ERROR.TIMEOUT,
  network: ERROR.NETWORK,
  upstream: ERROR.UPSTREAM,
};

/** Turns whatever the Google client threw (a GaxiosError, a network error) into a SheetsError. */
export function toSheetsError(error: unknown): SheetsError {
  if (error instanceof SheetsError) return error;

  const source = (typeof error === 'object' && error !== null ? error : {}) as UpstreamError;
  const detail = typeof source.message === 'string' ? source.message : String(error);
  const status = [source.response?.status, source.status, source.code]
    .map(Number)
    .find((value) => Number.isInteger(value) && value >= 100);

  const kind = kindOf(status, `${String(source.code)} ${detail}`);
  return new SheetsError(MESSAGE_BY_KIND[kind], kind, status, detail);
}

function kindOf(status: number | undefined, text: string): Exclude<SheetsErrorKind, 'config'> {
  if (/invalid_grant|invalid_client|unauthorized_client/i.test(text)) return 'auth';
  if (status === undefined)
    return /timeout|timed out|ETIMEDOUT|abort/i.test(text) ? 'timeout' : 'network';
  if (status === 429 || (status === 403 && /quota|rate ?limit/i.test(text))) return 'rate_limit';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'upstream';
  return 'invalid';
}
