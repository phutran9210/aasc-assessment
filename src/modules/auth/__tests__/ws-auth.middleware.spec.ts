import type { Socket } from 'socket.io';

import { createWsAuthMiddleware } from '../ws/ws-auth.middleware.js';
import type { AuthService } from '../services/auth.service.js';

const user = { id: 'user-1', username: 'alice' };

function socketWith(token: unknown): Socket {
  return { handshake: { auth: { token } }, data: {} } as unknown as Socket;
}

const flushPromise = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};

describe('createWsAuthMiddleware', () => {
  const authService = { verifyToken: jest.fn() };

  beforeEach(() => jest.resetAllMocks());

  it('should attach the verified user and continue for a string token', async () => {
    authService.verifyToken.mockResolvedValue(user);
    const socket = socketWith('good-token');
    const next = jest.fn();

    createWsAuthMiddleware(authService as unknown as AuthService)(socket, next);
    await flushPromise();

    expect(authService.verifyToken).toHaveBeenCalledWith('good-token');
    expect(socket.data.user).toBe(user);
    expect(next).toHaveBeenCalledWith();
  });

  it('should reject non-string tokens as missing tokens', async () => {
    authService.verifyToken.mockRejectedValue(new Error('missing token'));
    const socket = socketWith(123);
    const next = jest.fn();

    createWsAuthMiddleware(authService as unknown as AuthService)(socket, next);
    await flushPromise();

    expect(authService.verifyToken).toHaveBeenCalledWith(undefined);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'missing token' }));
  });

  it('should convert non-Error rejections into Error instances', async () => {
    authService.verifyToken.mockRejectedValue('invalid token');
    const socket = socketWith('bad-token');
    const next = jest.fn();

    createWsAuthMiddleware(authService as unknown as AuthService)(socket, next);
    await flushPromise();

    expect(next).toHaveBeenCalledWith(new Error('invalid token'));
  });
});
