import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';

import { clientIp, LOCAL_RATE_LIMITER, RATE_LIMITER } from '../services/rate-limiter.service.js';
import type {
  LocalRateLimiter,
  RateLimiter,
  RateLimitResult,
} from '../services/rate-limiter.service.js';

export const INGRESS_IP_LIMIT = 600;
export const RATE_WINDOW_MS = 60_000;
export const INGRESS_LIMIT_OPTIONS = Symbol('INGRESS_LIMIT_OPTIONS');

export type IngressLimitOptions = {
  /** Reverse proxies whose X-Forwarded-For header may be believed. */
  trustedProxies: readonly string[];
  /** Requests per minute per client address; defaults to 600. */
  limit?: number;
  /** Verified webhooks per minute per advertiser; defaults to 120. */
  advertiserLimit?: number;
};

/** Sets `Retry-After` and raises 429 when a window is exhausted. */
export function rejectWhenLimited(result: RateLimitResult, response: Response): void {
  if (result.allowed) return;
  response.setHeader('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
  throw new HttpException(
    { code: 'RATE_LIMITED', message: 'Too many requests' },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/**
 * First gate of unauthenticated endpoints: 600 requests per minute per client address. Redis
 * shares the count between instances; if Redis is down each process still enforces the same
 * limit locally, so an outage never opens the door.
 */
@Injectable()
export class IngressRateLimitGuard implements CanActivate {
  constructor(
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(LOCAL_RATE_LIMITER) private readonly local: LocalRateLimiter,
    @Inject(INGRESS_LIMIT_OPTIONS) private readonly options: IngressLimitOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const key = `ip:${clientIp(http.getRequest<Request>(), this.options.trustedProxies)}`;
    const limit = this.options.limit ?? INGRESS_IP_LIMIT;
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
