import { createHmac } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';

import { verifyMockSignature } from '../domain/mock-signature.js';

function signature(
  raw: Buffer,
  timestamp: number,
  secret = 'mock-secret-with-enough-length',
): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex');
  return `t=${timestamp},s=${digest}`;
}

describe('TikTok mock signature', () => {
  const now = 1_800_000_000;

  it('verifies the exact UTF-8 bytes including whitespace', () => {
    const raw = Buffer.from('{ "name": "Tiếng Việt" }', 'utf8');
    expect(() =>
      verifyMockSignature(raw, signature(raw, now), 'mock-secret-with-enough-length', now),
    ).not.toThrow();
    expect(() =>
      verifyMockSignature(
        Buffer.from(raw.toString().replaceAll(' ', '')),
        signature(raw, now),
        'mock-secret-with-enough-length',
        now,
      ),
    ).toThrow(UnauthorizedException);
  });

  it('accepts the exact 300 second clock boundaries and rejects stale timestamps', () => {
    const raw = Buffer.from('{}');
    expect(() =>
      verifyMockSignature(raw, signature(raw, now - 300), 'mock-secret-with-enough-length', now),
    ).not.toThrow();
    expect(() =>
      verifyMockSignature(raw, signature(raw, now + 300), 'mock-secret-with-enough-length', now),
    ).not.toThrow();
    expect(() =>
      verifyMockSignature(raw, signature(raw, now - 301), 'mock-secret-with-enough-length', now),
    ).toThrow(UnauthorizedException);
    expect(() =>
      verifyMockSignature(raw, signature(raw, now + 301), 'mock-secret-with-enough-length', now),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a well-formed header with an incorrect digest', () => {
    const raw = Buffer.from('{}');
    expect(() =>
      verifyMockSignature(
        raw,
        `t=${now},s=${'0'.repeat(64)}`,
        'mock-secret-with-enough-length',
        now,
      ),
    ).toThrow(UnauthorizedException);
  });

  it.each(['', 't=1,t=1,s=00', 't=1,s=00,s=00', 't=no,s=00', 't=1,s=xyz', 't=1,s=00'])(
    'rejects malformed or duplicate fields: %s',
    (header) => {
      expect(() =>
        verifyMockSignature(Buffer.from('{}'), header, 'mock-secret-with-enough-length', now),
      ).toThrow(UnauthorizedException);
    },
  );
});
