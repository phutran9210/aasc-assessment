import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { JotformWebhookSecretGuard } from '../guards/jotform-webhook-secret.guard.js';

const SECRET = 'webhook-secret-0123456789';

const contextWith = (query: Record<string, unknown>): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ query }) }) }) as unknown as ExecutionContext;

const guardWith = (webhookSecret: string | undefined): JotformWebhookSecretGuard =>
  new JotformWebhookSecretGuard({
    apiKey: 'key',
    formId: '1',
    webhookSecret,
    apiBaseUrl: 'https://api.jotform.com',
    timeoutMs: 10_000,
  });

describe('JotformWebhookSecretGuard', () => {
  it('should let a request with the right secret through', () => {
    expect(guardWith(SECRET).canActivate(contextWith({ secret: SECRET }))).toBe(true);
  });

  it.each([
    ['a wrong secret', { secret: 'webhook-secret-0123456780' }],
    ['a secret of another length', { secret: 'short' }],
    ['no secret', {}],
    ['a repeated secret parameter', { secret: [SECRET, SECRET] }],
  ])('should refuse %s with 401', (_label, query) => {
    expect(() => guardWith(SECRET).canActivate(contextWith(query))).toThrow(UnauthorizedException);
  });

  it('should answer 503 when no secret is configured, even if none is sent', () => {
    expect(() => guardWith(undefined).canActivate(contextWith({}))).toThrow(
      ServiceUnavailableException,
    );
  });
});
