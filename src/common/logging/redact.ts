export const REDACTED = '[REDACTED]';

const MAX_DEPTH = 12;
const SECRET_KEY =
  /pass(word)?|secret|token|authorization|signature|cookie|api[-_]?key|credential|raw[-_]?body|^auth$/i;
const EMAIL_KEY = /^e?-?mail(_address)?$/i;
const PHONE_KEY = /^(phone|mobile|tel)(_?number|_e164)?$/i;

const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const PHONE = /\+\d{8,15}\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{3,}\b/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
// Bitrix24 inbound webhook URLs carry the credential as a path segment: /rest/<user>/<secret>/.
const BITRIX_WEBHOOK = /(\/rest\/\d+\/)[A-Za-z0-9]{8,}(?=\/|$|\s|\?)/g;
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]*:[^\s/@]*@/gi;
const SECRET_PARAMETER =
  /\b((?:access_|refresh_|id_)?token|auth|client_secret|secret|password|signature|api_?key|code)=([^\s&#"']+)/gi;

/** Removes credentials and masks contact data inside free text such as an upstream message. */
export function redactText(text: string): string {
  return text
    .replace(URL_USERINFO, `$1${REDACTED}@`)
    .replace(BITRIX_WEBHOOK, `$1${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(BEARER, `$1 ${REDACTED}`)
    .replace(SECRET_PARAMETER, `$1=${REDACTED}`)
    .replace(EMAIL, '$1***@$2')
    .replace(PHONE, maskPhone);
}

/**
 * Returns a copy that is safe to log: secret-bearing keys are replaced, strings are scrubbed,
 * errors are reduced to name/message/code/cause without a stack, and cycles or very deep values
 * cannot make the logger throw. The input is never modified.
 */
export function redact(input: unknown): unknown {
  return visit(input, 0, new WeakSet<object>());
}

function visit(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;
  if (value === null || typeof value !== 'object') return value;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  }
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => visit(item, depth + 1, seen));

  const output: Record<string, unknown> = {};
  if (value instanceof Error) {
    output.name = value.name;
    output.message = redactText(value.message);
    if (value.cause !== undefined) output.cause = visit(value.cause, depth + 1, seen);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (value instanceof Error && key === 'stack') continue;
    if (SECRET_KEY.test(key)) output[key] = REDACTED;
    else if (typeof entry === 'string' && EMAIL_KEY.test(key)) output[key] = maskEmail(entry);
    else if (typeof entry === 'string' && PHONE_KEY.test(key)) output[key] = maskPhone(entry);
    else output[key] = visit(entry, depth + 1, seen);
  }
  return output;
}

function maskEmail(value: string): string {
  const masked = value.replace(EMAIL, '$1***@$2');
  return masked === value ? REDACTED : masked;
}

function maskPhone(value: string): string {
  if (value.length <= 5) return REDACTED;
  return `${value.slice(0, 3)}${'*'.repeat(value.length - 5)}${value.slice(-2)}`;
}
