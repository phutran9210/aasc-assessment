import { BitrixHttpError } from '@modules/bitrix/index.js';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard.js';

import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { LeadSyncBusyError, LeadSyncConfigError } from '../errors/index.js';
import { BitrixLeadEvents } from '../services/bitrix-lead-events.service.js';
import { LeadPullback } from '../services/lead-pullback.service.js';

/** Bitrix24 → Sheet entry points of the two-way sync (`LEAD_SYNC_DIRECTION=two-way`). */
@ApiTags('Lead Sync')
@Controller('lead-sync')
export class LeadSyncEventsController {
  constructor(
    private readonly events: BitrixLeadEvents,
    private readonly pullback: LeadPullback,
  ) {}

  /**
   * Called by Bitrix24, so there is no JWT: the `application_token` inside the event is checked
   * instead. Answers at once; the Sheet is updated a moment later, in the background.
   */
  @Post('bitrix-events')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bitrix24 gọi khi một lead thay đổi (ONCRMLEADUPDATE)' })
  async receive(@Body() body: unknown): Promise<{ received: true }> {
    await this.events.receive(body);
    return { received: true };
  }

  @Post('bitrix-events/register')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Đăng ký nhận sự kiện lead với Bitrix24 (event.bind)' })
  async register(): Promise<{ event: string; handler: string }> {
    try {
      return await this.events.register();
    } catch (error) {
      throw toHttpError(error);
    }
  }

  @Post('pull')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Kéo giai đoạn và người phụ trách của mọi lead về Sheet (chạy nền)' })
  async pull(): Promise<{ runId: string }> {
    try {
      const { run } = await this.pullback.start('all', 'pull');
      return { runId: run.id };
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

function toHttpError(error: unknown): unknown {
  if (error instanceof LeadSyncBusyError) return new ConflictException(error.message);
  if (error instanceof LeadSyncConfigError) return new ServiceUnavailableException(error.message);
  if (error instanceof BitrixHttpError) {
    return new BadGatewayException(error.code ? `${error.message} (${error.code})` : error.message);
  }
  return error;
}
