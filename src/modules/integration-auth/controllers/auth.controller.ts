import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';

import { IngressRateLimitGuard } from '@core/queue/guards/ingress-rate-limit.guard.js';
import { IntegrationAuthService } from '../services/integration-auth.service.js';
import { LoginDto } from '../dto/login.dto.js';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: IntegrationAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(IngressRateLimitGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  login(@Body() credentials: LoginDto, @Ip() ipAddress: string) {
    return this.auth.login(credentials, ipAddress);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Headers('authorization') authorization?: string): Promise<void> {
    await this.auth.logoutAuthorizationHeader(authorization);
  }
}
