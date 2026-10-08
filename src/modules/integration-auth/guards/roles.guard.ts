import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { Request } from 'express';

import { INTEGRATION_ROLES_KEY } from '../decorators/roles.decorator.js';
import type { Actor, IntegrationRole } from '../types/actor.type.js';

@Injectable()
export class IntegrationRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<IntegrationRole[]>(
      INTEGRATION_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles?.length) return true;
    const request = context.switchToHttp().getRequest<Request & { user?: Actor }>();
    if (requiredRoles.some((role) => request.user?.roles.includes(role))) return true;
    throw new ForbiddenException('Insufficient role');
  }
}
