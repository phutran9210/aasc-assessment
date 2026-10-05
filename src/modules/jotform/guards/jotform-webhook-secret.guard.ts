import { createHash, timingSafeEqual } from 'node:crypto';

import { jotformConfig } from '@config/index.js';
import type { JotformConfig } from '@config/index.js';

import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';

import type { Request } from 'express';

import { JOTFORM_MESSAGES } from '../messages/index.js';

/**
 * Jotform does not sign its webhooks, so the webhook URL carries a shared secret:
 * `/jotform/webhook?secret=...`. It is read from the query because guards run before the
 * multipart body is parsed.
 */
@Injectable()
export class JotformWebhookSecretGuard implements CanActivate {
  constructor(@Inject(jotformConfig.KEY) private readonly config: JotformConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.webhookSecret;
    if (!expected) throw new ServiceUnavailableException(JOTFORM_MESSAGES.ERROR.CONFIG);

    const { secret } = context.switchToHttp().getRequest<Request>().query;
    if (typeof secret !== 'string' || !sameSecret(secret, expected)) {
      throw new UnauthorizedException(JOTFORM_MESSAGES.ERROR.SECRET_INVALID);
    }
    return true;
  }
}

/** Constant-time comparison; hashing first gives both sides the same length. */
function sameSecret(received: string, expected: string): boolean {
  const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(received), digest(expected));
}
