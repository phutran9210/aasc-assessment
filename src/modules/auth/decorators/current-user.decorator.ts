import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import type { Request } from 'express';

import type { AuthUser } from '../types/index.js';

export type AuthenticatedRequest = Request & { user: AuthUser };

/** Injects the user set by `JwtAuthGuard`. Only use on routes protected by that guard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
