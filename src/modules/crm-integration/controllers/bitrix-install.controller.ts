import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { BITRIX_CONFIG } from '../../../modules/bitrix/ports/bitrix-config.port.js';
import { BitrixOAuthService } from '../../../modules/bitrix/services/bitrix-oauth.service.js';
import {
  normalizeInstallPayload,
  validateBitrixInstallEvent,
} from '../../../modules/bitrix/utils/normalize-install-payload.js';
import { Inject } from '@nestjs/common';
import type { BitrixConfig } from '../../../config/index.js';
import { BitrixInstallAdminGuard } from './bitrix-install-admin.guard.js';

@Controller('install')
export class TiktokBitrixInstallController {
  constructor(
    private readonly oauthService: BitrixOAuthService,
    @Inject(BITRIX_CONFIG) private readonly config: BitrixConfig,
  ) {}

  @Get('authorize')
  @UseGuards(BitrixInstallAdminGuard)
  async authorize(@Res() response: Response): Promise<void> {
    response.redirect(await this.oauthService.createAuthorizationUrl());
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
  ): Promise<{ status: string }> {
    if (!code || !state) throw new BadRequestException('Bitrix OAuth code and state are required');
    await this.oauthService.completeAuthorization(code, state);
    return { status: 'ok' };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async install(@Body() body: Record<string, unknown>): Promise<{ status: string }> {
    const event = normalizeInstallPayload(body);
    if (!validateBitrixInstallEvent(event, this.config.portalDomain)) {
      throw new BadRequestException('Bitrix install endpoint is not allowed');
    }
    await this.oauthService.handleInstallEvent(event);
    return { status: 'ok' };
  }
}
