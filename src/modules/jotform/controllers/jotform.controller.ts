import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard.js';

import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { NoFilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JotformWebhookSecretGuard } from '../guards/jotform-webhook-secret.guard.js';
import { JOTFORM_MESSAGES } from '../messages/index.js';
import { JotformSyncService } from '../services/jotform-sync.service.js';
import type { JotformSyncOutcome, JotformSyncSummary } from '../types/index.js';

/** Entry points of the Jotform → Bitrix24 integration. */
@ApiTags('Jotform')
@Controller('jotform')
export class JotformController {
  constructor(private readonly syncService: JotformSyncService) {}

  /**
   * Webhook Jotform calls on every form submission (multipart/form-data). Only `submissionID`
   * and `formID` are used; the answers are read back through the Jotform API.
   */
  @Post('webhook')
  @ApiOperation({ summary: 'Webhook nhận submission mới từ Jotform' })
  @HttpCode(HttpStatus.OK)
  @UseGuards(JotformWebhookSecretGuard)
  @UseInterceptors(NoFilesInterceptor())
  receive(@Body() body: Record<string, unknown> | undefined): Promise<JotformSyncOutcome> {
    const submissionId = textField(body?.submissionID);
    if (!submissionId) {
      throw new BadRequestException(JOTFORM_MESSAGES.ERROR.SUBMISSION_ID_REQUIRED);
    }
    return this.syncService.processSubmission(submissionId, textField(body?.formID));
  }

  /** Re-reads the newest submissions from Jotform and syncs those that are not synced yet. */
  @Post('sync')
  @ApiOperation({ summary: 'Đồng bộ lại các submission bị lỡ hoặc lỗi' })
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  sync(): Promise<JotformSyncSummary> {
    return this.syncService.syncForm();
  }
}

function textField(value: unknown): string | undefined {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return text || undefined;
}
