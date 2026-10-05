import type { UserResponse } from '@modules/user/types/index.js';

import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { ApiAuthLogin, ApiAuthRegister } from '../decorators/index.js';
import { CredentialsDto } from '../dto/index.js';
import { AuthService } from '../services/auth.service.js';
import type { LoginResponse } from '../types/index.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiAuthRegister()
  register(@Body() dto: CredentialsDto): Promise<UserResponse> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiAuthLogin()
  login(@Body() dto: CredentialsDto): Promise<LoginResponse> {
    return this.authService.login(dto);
  }
}
