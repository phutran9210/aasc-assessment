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

/** Accepts the install event as JSON, as nested form fields, or as flat `auth[key]` fields. */
function normalizeInstallPayload(body: Record<string, unknown>): BitrixInstallEvent {
  // Express parses `auth[key]=value` form fields into a nested object but leaves values as strings.
  if (isRecord(body.auth)) {
    const nestedAuth = { ...body.auth };
    if (typeof nestedAuth.expires_in === 'string') {
      nestedAuth.expires_in = Number(nestedAuth.expires_in);
    }
    return { ...body, auth: nestedAuth } as unknown as BitrixInstallEvent;
  }

  const data: Record<string, unknown> = {};
  const auth: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    const dataMatch = /^data\[([^\]]+)\]$/.exec(key);
    const authMatch = /^auth\[([^\]]+)\]$/.exec(key);
    if (dataMatch) data[dataMatch[1]] = value;
    if (authMatch) auth[authMatch[1]] = value;
  }
  if (typeof auth.expires_in === 'string') auth.expires_in = Number(auth.expires_in);
  return {
    event: typeof body.event === 'string' ? body.event : '',
    data,
    ts: typeof body.ts === 'string' ? body.ts : '',
    auth: auth as unknown as BitrixInstallEvent['auth'],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
