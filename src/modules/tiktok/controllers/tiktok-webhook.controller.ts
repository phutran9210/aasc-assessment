import { Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { TiktokInboxService } from '../services/tiktok-inbox.service.js';
import { TiktokSignatureGuard } from '../guards/tiktok-signature.guard.js';
import type { VerifiedWebhookRequest } from '../types/webhook-request.types.js';

@Controller('webhooks/tiktok')
export class TiktokWebhookController {
  constructor(private readonly inbox: TiktokInboxService) {}

  @Post('leads')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TiktokSignatureGuard)
  receive(@Req() request: VerifiedWebhookRequest) {
    return this.inbox.receive(request.verifiedTiktokEvent, request.rawBody);
  }
}
