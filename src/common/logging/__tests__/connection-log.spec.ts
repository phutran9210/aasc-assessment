import { describeConnectionUrl, safeErrorMessage, safeErrorStack } from '../connection-log.js';
import { REDACTED } from '../redact.js';

describe('describeConnectionUrl', () => {
  it('should hide the credentials when the URL carries a user and password', () => {
    expect(describeConnectionUrl('postgres://tiktok:pa55word@db.internal:5432/tiktok')).toBe(
      `postgres://${REDACTED}@db.internal:5432/tiktok`,
    );
  });

  it('should hide the credentials when the URL carries only a password', () => {
    expect(describeConnectionUrl('rediss://:pa55word@redis.internal:6380/2')).toBe(
      `rediss://${REDACTED}@redis.internal:6380/2`,
    );
  });

  it('should drop the query string when it could carry a secret', () => {
    const described = describeConnectionUrl(
      'postgres://db.internal/tiktok?password=pa55word&sslmode=require',
    );

    expect(described).toBe('postgres://db.internal/tiktok');
  });

  it('should keep the target unchanged when the URL has no credentials', () => {
    expect(describeConnectionUrl('redis://127.0.0.1:6379')).toBe('redis://127.0.0.1:6379');
  });

  it('should not echo the value when it is not a URL', () => {
    expect(describeConnectionUrl('user:pa55word@db.internal')).not.toContain('pa55word');
    expect(describeConnectionUrl('')).toBe('unparsable connection URL');
  });
});

describe('safeErrorMessage', () => {
  it('should remove credentials when the driver quotes the connection URL', () => {
    const error = new Error('connect ECONNREFUSED redis://default:pa55word@redis.internal:6379');

    expect(safeErrorMessage(error)).toBe(
      `connect ECONNREFUSED redis://${REDACTED}@redis.internal:6379`,
    );
  });

  it('should describe the value when it is not an Error', () => {
    expect(safeErrorMessage('password=pa55word rejected')).toBe(`password=${REDACTED} rejected`);
  });
});

describe('safeErrorStack', () => {
  it('should remove credentials when the stack repeats the message', () => {
    const stack = safeErrorStack(new Error('failed for postgres://tiktok:pa55word@db.internal/x'));

    expect(stack).toContain(`postgres://${REDACTED}@db.internal/x`);
    expect(stack).not.toContain('pa55word');
  });

  it('should return undefined when the value is not an Error', () => {
    expect(safeErrorStack('boom')).toBeUndefined();
  });
});
