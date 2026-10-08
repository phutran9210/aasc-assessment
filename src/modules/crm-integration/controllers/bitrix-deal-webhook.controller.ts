import { Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { BitrixDealInbox } from '../services/bitrix-deal-inbox.service.js';
import type { RawRequest } from '../types/raw-request.type.js';

@Controller('webhooks/bitrix24/deals')
export class BitrixDealWebhookController {
  constructor(private readonly inbox: BitrixDealInbox) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  receive(@Req() request: RawRequest) {
    return this.inbox.receive(request.rawBody ?? request.body, request.headers);
  }
}
