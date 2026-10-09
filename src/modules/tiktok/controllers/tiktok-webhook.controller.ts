import { Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { TiktokInboxService } from '../services/tiktok-inbox.service.js';
import { IngressRateLimitGuard } from '@core/queue/guards/ingress-rate-limit.guard.js';
import { TiktokSignatureGuard } from '../guards/tiktok-signature.guard.js';
import { WebhookAdvertiserLimitGuard } from '../guards/webhook-advertiser-limit.guard.js';
import type { VerifiedWebhookRequest } from '../types/webhook-request.types.js';

@Controller('webhooks/tiktok')
export class TiktokWebhookController {
  constructor(private readonly inbox: TiktokInboxService) {}

  @Post('leads')
  @HttpCode(HttpStatus.OK)
  @UseGuards(IngressRateLimitGuard, TiktokSignatureGuard, WebhookAdvertiserLimitGuard)
  receive(@Req() request: VerifiedWebhookRequest) {
    return this.inbox.receive(request.verifiedTiktokEvent, request.rawBody);
  }
}
