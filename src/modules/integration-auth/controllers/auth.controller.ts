import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';

import { IntegrationAuthService } from '../services/integration-auth.service.js';
import { LoginDto } from '../dto/login.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: IntegrationAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  login(@Body() credentials: LoginDto, @Ip() ipAddress: string) {
    return this.auth.login(credentials, ipAddress);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Headers('authorization') authorization?: string): Promise<void> {
    const [scheme, token] = authorization?.split(' ') ?? [];
    await this.auth.logout(scheme === 'Bearer' ? token : undefined);
  }
}
