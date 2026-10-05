import { CurrentUser } from '@modules/auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard.js';
import type { AuthUser } from '@modules/auth/types/index.js';

import { Body, Controller, Get, HttpCode, HttpStatus, Patch, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { ApiUserMe, ApiUserUpdateMe } from '../decorators/index.js';
import { UpdateProfileDto } from '../dto/index.js';
import { UserService } from '../services/user.service.js';
import type { UserResponse } from '../types/index.js';

/** Every route acts on the logged-in user: there is no `:id`, so nobody can edit someone else. */
@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiUserMe()
  getMe(@CurrentUser() user: AuthUser): Promise<UserResponse> {
    return this.userService.getProfile(user.id);
  }

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @ApiUserUpdateMe()
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto): Promise<UserResponse> {
    return this.userService.updateProfile(user.id, dto);
  }
}
