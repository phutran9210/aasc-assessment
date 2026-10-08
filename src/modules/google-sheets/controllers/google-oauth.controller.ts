import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard.js';

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { GOOGLE_SHEETS_MESSAGES } from '../messages/index.js';
import { GoogleOAuthService } from '../services/google-oauth.service.js';

/** OAuth 2.0 consent for Google Sheets, used when `GOOGLE_AUTH_MODE=oauth`. */
@ApiTags('Google OAuth')
@Controller('google/oauth')
export class GoogleOAuthController {
  constructor(private readonly oauth: GoogleOAuthService) {}

  @Get('authorize')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Lấy đường dẫn cấp quyền Google Sheets' })
  authorize(): { url: string } {
    return { url: this.oauth.authorizationUrl() };
  }

  /**
   * Google redirects the browser here, so there is no JWT: the one-time `state` issued by
   * `authorize` is what proves the request belongs to a logged-in admin.
   */
  @Get('callback')
  @ApiOperation({ summary: 'Google chuyển hướng về đây sau khi người dùng đồng ý' })
  async callback(
    @Query('code') code = '',
    @Query('state') state = '',
  ): Promise<{ message: string }> {
    await this.oauth.complete(code, state);
    return { message: GOOGLE_SHEETS_MESSAGES.SUCCESS.OAUTH_AUTHORIZED };
  }
}
