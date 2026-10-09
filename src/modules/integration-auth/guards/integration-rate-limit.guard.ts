import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';

import { RATE_WINDOW_MS, rejectWhenLimited } from '@core/queue/guards/ingress-rate-limit.guard.js';
import type {
  LocalRateLimiter,
  RateLimiter,
  RateLimitResult,
} from '@core/queue/services/rate-limiter.service.js';
import type { Actor } from '../types/actor.type.js';

export const USER_READ_LIMIT = 120;
export const USER_MUTATION_LIMIT = 30;

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Per-user limit of the management API: 120 reads and 30 mutations per minute. It runs after
 * authentication. Without Redis a mutation is refused with 503, because an unmetered write is
 * worse than a delayed one, while reads fall back to a per-process limit.
 */
@Injectable()
export class IntegrationRateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: RateLimiter,
    private readonly local: LocalRateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: Actor }>();
    if (!request.user) return true;

    const mutation = !READ_METHODS.has(request.method.toUpperCase());
    const key = `user:${request.user.sub}:${mutation ? 'mutation' : 'read'}`;
    const limit = mutation ? USER_MUTATION_LIMIT : USER_READ_LIMIT;
    let result: RateLimitResult;
    try {
      result = await this.limiter.consume(key, limit, RATE_WINDOW_MS);
    } catch {
      if (mutation) {
        throw new ServiceUnavailableException({
          code: 'RATE_LIMITER_UNAVAILABLE',
          message: 'Changes are temporarily unavailable',
        });
      }
      result = this.local.consume(key, limit, RATE_WINDOW_MS);
    }
    rejectWhenLimited(result, http.getResponse<Response>());
    return true;
  }
}
