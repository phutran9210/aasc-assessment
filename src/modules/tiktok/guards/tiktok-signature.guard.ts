import {
  CanActivate,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import type { TiktokAppConfig } from '@config/tiktok-app/env.validation.js';
import { parseWebhookEnvelope } from '../domain/webhook-envelope.js';
import { verifyMockSignature } from '../domain/mock-signature.js';
import type { GuardedWebhookRequest } from '../types/webhook-request.types.js';
import { TIKTOK_WEBHOOK_CONFIG } from '../constants/index.js';

@Injectable()
export class TiktokSignatureGuard implements CanActivate {
  constructor(@Inject(TIKTOK_WEBHOOK_CONFIG) private readonly config: TiktokAppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.config.tiktokMode !== 'mock') {
      throw new ServiceUnavailableException(
        'TikTok Business webhook verification is not configured',
      );
    }
    const request = context.switchToHttp().getRequest<GuardedWebhookRequest>();
    const raw = request.rawBody;
    if (!Buffer.isBuffer(raw)) throw new UnauthorizedException('TikTok raw body is unavailable');
    const header = request.headers['tiktok-signature'];
    if (typeof header !== 'string') throw new UnauthorizedException('Invalid TikTok signature');
    verifyMockSignature(raw, header, this.config.webhookSecret, Math.floor(Date.now() / 1000));
    const event = parseWebhookEnvelope(request.body);
    if (event.advertiserId !== this.config.advertiserId) {
      throw new ForbiddenException('TikTok advertiser is not allowed');
    }
    request.verifiedTiktokEvent = event;
    return true;
  }
}
