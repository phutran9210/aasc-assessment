import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';

import { JwtAuthGuard } from '../guards/jwt-auth.guard.js';
import type { AuthService } from '../services/auth.service.js';

function contextWith(authorization?: string) {
  const request: { headers: Record<string, string | undefined>; user?: unknown } = {
    headers: { authorization },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('JwtAuthGuard', () => {
  const verifyToken = jest.fn();
  const guard = new JwtAuthGuard({ verifyToken } as unknown as AuthService);

  beforeEach(() => jest.resetAllMocks());

  it('should attach the user and allow the request when the bearer token is valid', async () => {
    verifyToken.mockResolvedValue({ id: 'user-1', username: 'alice' });
    const { context, request } = contextWith('Bearer good-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyToken).toHaveBeenCalledWith('good-token');
    expect(request.user).toEqual({ id: 'user-1', username: 'alice' });
  });

  it.each([[undefined], ['good-token'], ['Basic good-token'], ['Bearer']])(
    'should verify no token when the Authorization header is %p',
    async (authorization) => {
      verifyToken.mockRejectedValue(new UnauthorizedException());
      const { context } = contextWith(authorization);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(verifyToken).toHaveBeenCalledWith(undefined);
    },
  );
});
