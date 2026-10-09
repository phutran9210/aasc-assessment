import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';

import {
  INGRESS_LIMIT_OPTIONS,
  RATE_WINDOW_MS,
  rejectWhenLimited,
} from '@core/queue/guards/ingress-rate-limit.guard.js';
import type { IngressLimitOptions } from '@core/queue/guards/ingress-rate-limit.guard.js';
import { LOCAL_RATE_LIMITER, RATE_LIMITER } from '@core/queue/services/rate-limiter.service.js';
import type {
  LocalRateLimiter,
  RateLimiter,
  RateLimitResult,
} from '@core/queue/services/rate-limiter.service.js';
import type { VerifiedWebhookRequest } from '../types/webhook-request.types.js';

export const WEBHOOK_ADVERTISER_LIMIT = 120;

/**
 * 120 verified webhooks per minute per advertiser. It runs after the signature check, so an
 * unsigned flood cannot spend an advertiser's budget, and keeps a local limit without Redis.
 */
@Injectable()
export class WebhookAdvertiserLimitGuard implements CanActivate {
  constructor(
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(LOCAL_RATE_LIMITER) private readonly local: LocalRateLimiter,
    @Inject(INGRESS_LIMIT_OPTIONS)
    private readonly options: Pick<IngressLimitOptions, 'advertiserLimit'>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const advertiserId = http.getRequest<VerifiedWebhookRequest>().verifiedTiktokEvent.advertiserId;
    const key = `webhook-advertiser:${advertiserId}`;
    const limit = this.options.advertiserLimit ?? WEBHOOK_ADVERTISER_LIMIT;
    let result: RateLimitResult;
    try {
      result = await this.limiter.consume(key, limit, RATE_WINDOW_MS);
    } catch {
      result = this.local.consume(key, limit, RATE_WINDOW_MS);
    }
    rejectWhenLimited(result, http.getResponse<Response>());
    return true;
  }
}
