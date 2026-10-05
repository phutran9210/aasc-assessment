import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';

import type { Request } from 'express';

import { AuthService } from '../services/auth.service.js';
import type { AuthUser } from '../types/index.js';

/** Requires `Authorization: Bearer <token>` and exposes the verified user as `request.user`. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];

    request.user = await this.authService.verifyToken(scheme === 'Bearer' ? token : undefined);
    return true;
  }
}
