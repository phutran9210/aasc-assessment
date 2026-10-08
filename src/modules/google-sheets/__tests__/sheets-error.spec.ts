import { SheetsError, toSheetsError } from '../errors/sheets.error.js';

const gaxios = (status: number, message = 'error'): Error =>
  Object.assign(new Error(message), { status, response: { status } });

describe('toSheetsError', () => {
  it.each([
    [401, 'auth', false],
    [403, 'auth', false],
    [404, 'not_found', false],
    [400, 'invalid', false],
    [429, 'rate_limit', true],
    [500, 'upstream', true],
    [503, 'upstream', true],
  ] as const)('should map HTTP %i to kind "%s" (retryable: %s)', (status, kind, retryable) => {
    expect(toSheetsError(gaxios(status))).toMatchObject({ kind, status, retryable });
  });

  it('should treat a 403 about quota as a rate limit, not as a permission problem', () => {
    expect(
      toSheetsError(gaxios(403, "Quota exceeded for quota metric 'Read requests'")),
    ).toMatchObject({ kind: 'rate_limit', retryable: true });
  });

  it('should treat a rejected service account key as an auth error', () => {
    expect(toSheetsError(gaxios(400, 'invalid_grant: Invalid JWT Signature.'))).toMatchObject({
      kind: 'auth',
    });
  });

  it('should tell a timeout from another network failure', () => {
    expect(
      toSheetsError(Object.assign(new Error('network timeout'), { code: 'ETIMEDOUT' })),
    ).toMatchObject({ kind: 'timeout', retryable: true });
    expect(
      toSheetsError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })),
    ).toMatchObject({ kind: 'network', retryable: true });
  });

  it('should keep the upstream text in detail and show a Vietnamese message', () => {
    const error = toSheetsError(gaxios(403, 'The caller does not have permission'));

    expect(error.message).toMatch(/^Google từ chối truy cập/);
    expect(error.detail).toBe('The caller does not have permission');
  });

  it('should pass an existing SheetsError through unchanged', () => {
    const original = new SheetsError('x', 'config');

    expect(toSheetsError(original)).toBe(original);
  });
});
