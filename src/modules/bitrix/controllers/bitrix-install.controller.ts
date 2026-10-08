import {
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
import { BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import type { Response } from 'express';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard.js';

import { BITRIX_MESSAGES } from '../messages/index.js';
import { BitrixOAuthService } from '../services/bitrix-oauth.service.js';
import type { BitrixInstallEvent } from '../types/index.js';
import { normalizeInstallPayload } from '../utils/normalize-install-payload.js';

/** Entry points of the Bitrix24 OAuth 2.0 flow, all under `/install`. */
@ApiTags('Bitrix24')
@Controller('install')
export class BitrixInstallController {
  constructor(private readonly oauthService: BitrixOAuthService) {}

  /**
   * Install callback. Bitrix24 posts ONAPPINSTALL/ONAPPUPDATE here (form-encoded) with a ready
   * token pair, which is verified against the portal and stored.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async install(@Body() body: Record<string, unknown>): Promise<{ status: string }> {
    const payload = normalizeInstallPayload(body);
    if (!isCompleteAuth(payload.auth) || !payload.event) {
      throw new BadRequestException(BITRIX_MESSAGES.ERROR.INSTALL_PAYLOAD_INVALID);
    }
    await this.oauthService.handleInstallEvent(payload);
    return { status: 'ok' };
  }

  /** Starts the full OAuth flow: redirects a logged-in admin to the portal's consent page. */
  @Get('authorize')
  @UseGuards(JwtAuthGuard)
  async authorize(@Res() response: Response): Promise<void> {
    response.redirect(await this.oauthService.createAuthorizationUrl());
  }

  /** OAuth redirect target: exchanges the one-time `code` (valid 30 seconds) for tokens. */
  @Get()
  @HttpCode(HttpStatus.OK)
  async callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
  ): Promise<{ status: string }> {
    if (!code || !state)
      throw new BadRequestException(BITRIX_MESSAGES.ERROR.CODE_AND_STATE_REQUIRED);
    await this.oauthService.completeAuthorization(code, state);
    return { status: 'ok' };
  }
}

/** True when the event carries every field needed to store and later refresh the tokens. */
function isCompleteAuth(auth: BitrixInstallEvent['auth']): boolean {
  return Boolean(
    auth &&
    auth.domain &&
    auth.scope &&
    auth.access_token &&
    auth.refresh_token &&
    auth.server_endpoint &&
    auth.client_endpoint &&
    auth.member_id &&
    Number.isFinite(auth.expires_in),
  );
}
