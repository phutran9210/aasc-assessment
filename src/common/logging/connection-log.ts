import { REDACTED, redactText } from './redact.js';

const UNPARSABLE = 'unparsable connection URL';

/**
 * Connection target that is safe to log: scheme, host, port and database only. Credentials are
 * replaced and the query string is dropped, because drivers accept secrets there as well.
 */
export function describeConnectionUrl(connectionUrl: string): string {
  try {
    const url = new URL(connectionUrl);
    // `user:secret@host` parses as scheme `user:` with the secret in the path, so require a host.
    if (!url.host) return UNPARSABLE;
    const credentials = url.username || url.password ? `${REDACTED}@` : '';
    return `${url.protocol}//${credentials}${url.host}${url.pathname}`;
  } catch {
    // Never echo a value that could not be parsed: it may still contain a password.
    return UNPARSABLE;
  }
}

/** Error message with credentials removed; drivers may quote the connection URL in it. */
export function safeErrorMessage(error: unknown): string {
  return redactText(error instanceof Error ? error.message : String(error));
}

/** Error stack with credentials removed, since the first stack line repeats the message. */
export function safeErrorStack(error: unknown): string | undefined {
  return error instanceof Error && error.stack ? redactText(error.stack) : undefined;
}
