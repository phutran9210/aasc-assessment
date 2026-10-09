import type { ExecutionContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';

import { LocalRateLimiter } from '@core/queue/services/rate-limiter.service.js';
import type { RateLimiter } from '@core/queue/services/rate-limiter.service.js';
import {
  WEBHOOK_ADVERTISER_LIMIT,
  WebhookAdvertiserLimitGuard,
} from '../guards/webhook-advertiser-limit.guard.js';

function context(advertiserId: string) {
  const headers: Record<string, string> = {};
  return {
    headers,
    context: {
      switchToHttp: () => ({
        getRequest: () => ({ verifiedTiktokEvent: { advertiserId } }),
        getResponse: () => ({
          setHeader: (name: string, value: string) => {
            headers[name] = value;
          },
        }),
      }),
    } as unknown as ExecutionContext,
  };
}

describe('webhook advertiser limit guard', () => {
  it('meters verified webhooks per advertiser at 120 per minute by default', async () => {
    const calls: Array<[string, number, number]> = [];
    const limiter: RateLimiter = {
      consume: (key, limit, windowMs) => {
        calls.push([key, limit, windowMs]);
        return Promise.resolve({ allowed: true, remaining: 1, retryAfterMs: 0 });
      },
    };
    const guard = new WebhookAdvertiserLimitGuard(limiter, new LocalRateLimiter(), {});

    await guard.canActivate(context('adv-1').context);

    expect(WEBHOOK_ADVERTISER_LIMIT).toBe(120);
    expect(calls).toEqual([['webhook-advertiser:adv-1', 120, 60_000]]);
  });

  it('uses the configured limit and falls back to a local window without Redis', async () => {
    const broken: RateLimiter = { consume: () => Promise.reject(new Error('redis down')) };
    const guard = new WebhookAdvertiserLimitGuard(broken, new LocalRateLimiter(), {
      advertiserLimit: 2,
    });

    await guard.canActivate(context('adv-1').context);
    await guard.canActivate(context('adv-1').context);
    await guard.canActivate(context('adv-2').context);
    const blocked = context('adv-1');
    const error = await guard.canActivate(blocked.context).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect(Number(blocked.headers['Retry-After'])).toBeGreaterThanOrEqual(1);
  });
});
