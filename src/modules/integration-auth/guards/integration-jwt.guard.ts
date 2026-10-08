import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';

import type { Request } from 'express';

import { IntegrationAuthService } from '../services/integration-auth.service.js';
import type { Actor } from '../types/actor.type.js';

type AuthenticatedRequest = Request & { user?: Actor };

@Injectable()
export class IntegrationJwtGuard implements CanActivate {
  constructor(private readonly auth: IntegrationAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Bearer token is required');
    request.user = await this.auth.authenticate(token);
    return true;
  }
}
