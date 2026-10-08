import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';

type AuthenticatedRequest = Request & { user?: { roles?: string[] } };

/** Fail-closed bridge guard; Task 7 replaces this role check with the shared integration guard. */
@Injectable()
export class BitrixInstallAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user?.roles?.includes('integration_admin') ?? false;
  }
}
