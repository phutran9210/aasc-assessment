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
import type { Response } from 'express';

import { BitrixOAuthService } from '@modules/bitrix/index.js';
import { Roles } from '@modules/integration-auth/decorators/roles.decorator.js';
import { IntegrationJwtGuard } from '@modules/integration-auth/guards/integration-jwt.guard.js';
import { IntegrationRolesGuard } from '@modules/integration-auth/guards/roles.guard.js';

@Controller('install')
export class TiktokBitrixInstallController {
  constructor(private readonly oauthService: BitrixOAuthService) {}

  @Get('authorize')
  @UseGuards(IntegrationJwtGuard, IntegrationRolesGuard)
  @Roles('integration_admin')
  async authorize(@Res() response: Response): Promise<void> {
    response.redirect(await this.oauthService.createAuthorizationUrl());
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
  ): Promise<{ status: string }> {
    await this.oauthService.completeAuthorization(code, state);
    return { status: 'ok' };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async install(@Body() body: Record<string, unknown>): Promise<{ status: string }> {
    await this.oauthService.install(body);
    return { status: 'ok' };
  }
}
