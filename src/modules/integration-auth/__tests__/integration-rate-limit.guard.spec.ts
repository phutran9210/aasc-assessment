import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { IngressRateLimitGuard } from '@core/queue/guards/ingress-rate-limit.guard.js';
import { LocalRateLimiter } from '@core/queue/services/rate-limiter.service.js';
import type { RateLimiter } from '@core/queue/services/rate-limiter.service.js';
import {
  IntegrationRateLimitGuard,
  USER_MUTATION_LIMIT,
  USER_READ_LIMIT,
} from '../guards/integration-rate-limit.guard.js';

type Call = { key: string; limit: number; windowMs: number };

function httpContext(request: Record<string, unknown>) {
  const headers: Record<string, string> = {};
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        },
      }),
    }),
  } as unknown as ExecutionContext;
  return { context, headers };
}

function recordingLimiter(allowed = true, retryAfterMs = 0) {
  const calls: Call[] = [];
  const limiter: RateLimiter = {
    consume: (key, limit, windowMs) => {
      calls.push({ key, limit, windowMs });
      return Promise.resolve({ allowed, remaining: 0, retryAfterMs });
    },
  };
  return { limiter, calls };
}

const brokenLimiter: RateLimiter = { consume: () => Promise.reject(new Error('redis down')) };
const user = { sub: 'user-1', roles: ['integration_operator'] };

describe('integration rate limit guard', () => {
  it('uses 120 reads and 30 mutations per user per minute', async () => {
    const { limiter, calls } = recordingLimiter();
    const guard = new IntegrationRateLimitGuard(limiter, new LocalRateLimiter());

    await guard.canActivate(httpContext({ method: 'GET', user }).context);
    await guard.canActivate(httpContext({ method: 'POST', user }).context);
    await guard.canActivate(httpContext({ method: 'DELETE', user }).context);

    expect(USER_READ_LIMIT).toBe(120);
    expect(USER_MUTATION_LIMIT).toBe(30);
    expect(calls).toEqual([
      { key: 'user:user-1:read', limit: 120, windowMs: 60_000 },
      { key: 'user:user-1:mutation', limit: 30, windowMs: 60_000 },
      { key: 'user:user-1:mutation', limit: 30, windowMs: 60_000 },
    ]);
  });

  it('answers 429 with Retry-After in whole seconds when the window is exhausted', async () => {
    const guard = new IntegrationRateLimitGuard(
      recordingLimiter(false, 12_300).limiter,
      new LocalRateLimiter(),
    );
    const { context, headers } = httpContext({ method: 'GET', user });

    const error = await guard.canActivate(context).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect(headers['Retry-After']).toBe('13');
  });

  it('fails mutations closed and keeps reads on the local limit when Redis is down', async () => {
    const local = new LocalRateLimiter();
    const guard = new IntegrationRateLimitGuard(brokenLimiter, local);

    const mutation = await guard
      .canActivate(httpContext({ method: 'PUT', user }).context)
      .catch((caught: unknown) => caught);
    expect((mutation as HttpException).getStatus()).toBe(503);

    for (let index = 0; index < USER_READ_LIMIT; index += 1) {
      expect(await guard.canActivate(httpContext({ method: 'GET', user }).context)).toBe(true);
    }
    const blocked = await guard
      .canActivate(httpContext({ method: 'GET', user }).context)
      .catch((caught: unknown) => caught);
    expect((blocked as HttpException).getStatus()).toBe(429);
  });

  it('does nothing before a user is authenticated', async () => {
    const { limiter, calls } = recordingLimiter();

    expect(
      await new IntegrationRateLimitGuard(limiter, new LocalRateLimiter()).canActivate(
        httpContext({ method: 'GET' }).context,
      ),
    ).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe('ingress rate limit guard', () => {
  const peer = (remoteAddress: string, forwardedFor?: string) => ({
    method: 'POST',
    socket: { remoteAddress },
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
  });

  it('limits each peer address to 600 requests per minute', async () => {
    const { limiter, calls } = recordingLimiter();
    const guard = new IngressRateLimitGuard(limiter, new LocalRateLimiter(), {
      trustedProxies: [],
    });

    await guard.canActivate(httpContext(peer('203.0.113.9', '1.1.1.1')).context);

    expect(calls).toEqual([{ key: 'ip:203.0.113.9', limit: 600, windowMs: 60_000 }]);
  });

  it('keys on the forwarded client only behind an allow-listed proxy', async () => {
    const { limiter, calls } = recordingLimiter();
    const guard = new IngressRateLimitGuard(limiter, new LocalRateLimiter(), {
      trustedProxies: ['10.0.0.1'],
    });

    await guard.canActivate(httpContext(peer('10.0.0.1', '198.51.100.7')).context);

    expect(calls[0].key).toBe('ip:198.51.100.7');
  });

  it('keeps a hard local limit when Redis is unavailable', async () => {
    const guard = new IngressRateLimitGuard(brokenLimiter, new LocalRateLimiter(), {
      trustedProxies: [],
      limit: 3,
    });

    const outcomes = [];
    for (let index = 0; index < 4; index += 1) {
      outcomes.push(
        await guard.canActivate(httpContext(peer('203.0.113.9')).context).then(
          () => 200,
          (error: HttpException) => error.getStatus(),
        ),
      );
    }

    expect(outcomes).toEqual([200, 200, 200, 429]);
  });
});
