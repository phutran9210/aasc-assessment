import {
  Controller,
  HttpCode,
  HttpStatus,
  ServiceUnavailableException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { TiktokInboxService } from '../services/tiktok-inbox.service.js';
import { TiktokSignatureGuard } from '../guards/tiktok-signature.guard.js';
import type { VerifiedEvent } from '../domain/webhook-envelope.js';

type VerifiedWebhookRequest = RawBodyRequest<Request> & { verifiedTiktokEvent: VerifiedEvent };

@Controller('webhooks/tiktok')
export class TiktokWebhookController {
  constructor(private readonly inbox: TiktokInboxService) {}

  @Post('leads')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TiktokSignatureGuard)
  receive(@Req() request: VerifiedWebhookRequest) {
    if (!request.rawBody) throw new ServiceUnavailableException('TikTok raw body is unavailable');
    return this.inbox.receive(request.verifiedTiktokEvent, request.rawBody);
  }
}
