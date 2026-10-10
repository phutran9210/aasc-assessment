import bcrypt from 'bcrypt';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';

import { IntegrationAuthService } from '../services/integration-auth.service.js';

describe('IntegrationAuthService', () => {
  const config = { jwtTtlSeconds: 300 };
  const claims = { sub: 'user-1', sid: 'session-1', authVersion: 2 };
  let users: { findByUsername: jest.Mock; findById: jest.Mock };
  let sessions: {
    assertLoginAllowed: jest.Mock;
    resetLoginAttempts: jest.Mock;
    create: jest.Mock;
    revoke: jest.Mock;
    isActive: jest.Mock;
  };
  let jwt: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let service: IntegrationAuthService;

  beforeEach(() => {
    users = { findByUsername: jest.fn(), findById: jest.fn() };
    sessions = {
      assertLoginAllowed: jest.fn().mockResolvedValue(undefined),
      resetLoginAttempts: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockResolvedValue(undefined),
      revoke: jest.fn().mockResolvedValue(undefined),
      isActive: jest.fn().mockResolvedValue(true),
    };
    jwt = {
      signAsync: jest.fn().mockResolvedValue('signed-token'),
      verifyAsync: jest.fn().mockResolvedValue(claims),
    };
    service = new IntegrationAuthService(
      users as never,
      sessions as never,
      jwt as never,
      config as never,
    );
  });

  it('normalizes login details, creates a session, and returns only current roles', async () => {
    const passwordHash = await bcrypt.hash('correct horse', 4);
    users.findByUsername.mockResolvedValue({
      id: 'user-1',
      username: 'alice',
      passwordHash,
      active: true,
      authVersion: 2,
      roles: ['integration_admin', 'legacy_role'],
    });

    await expect(
      service.login({ username: ' Alice ', password: 'correct horse' }, '127.0.0.1'),
    ).resolves.toEqual({
      accessToken: 'signed-token',
      tokenType: 'Bearer',
      expiresIn: 300,
      user: { id: 'user-1', username: 'alice', roles: ['integration_admin'] },
    });
    expect(sessions.assertLoginAllowed).toHaveBeenCalledWith('127.0.0.1', 'alice');
    expect(sessions.resetLoginAttempts).toHaveBeenCalledWith('127.0.0.1', 'alice');
    expect(sessions.create).toHaveBeenCalledWith(expect.any(String), 'user-1', 2, 300, [
      'integration_admin',
      'legacy_role',
    ]);
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: 'user-1',
      sid: expect.any(String),
      authVersion: 2,
    });
  });

  it('rejects oversized passwords and honors the session login limiter', async () => {
    await expect(
      service.login({ username: 'alice', password: 'x'.repeat(73) }, 'ip'),
    ).rejects.toBeInstanceOf(BadRequestException);
    sessions.assertLoginAllowed.mockRejectedValueOnce(new Error('limited'));
    await expect(service.login({ username: 'alice', password: 'short' }, 'ip')).rejects.toThrow(
      'limited',
    );
    expect(users.findByUsername).not.toHaveBeenCalled();
  });

  it('uses a cached dummy hash for unknown users and rejects inactive users or wrong passwords', async () => {
    users.findByUsername.mockResolvedValue(null);
    await expect(
      service.login({ username: 'missing', password: 'wrong' }, 'ip'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.login({ username: 'missing', password: 'wrong' }, 'ip'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const passwordHash = await bcrypt.hash('secret', 4);
    users.findByUsername.mockResolvedValue({
      id: 'user-1',
      active: false,
      passwordHash,
      authVersion: 1,
      roles: [],
    });
    await expect(
      service.login({ username: 'alice', password: 'secret' }, 'ip'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    users.findByUsername.mockResolvedValue({
      id: 'user-1',
      active: true,
      passwordHash,
      authVersion: 1,
      roles: [],
    });
    await expect(
      service.login({ username: 'alice', password: 'wrong' }, 'ip'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessions.resetLoginAttempts).not.toHaveBeenCalled();
  });

  it('revokes the newly created session if signing the token fails', async () => {
    const passwordHash = await bcrypt.hash('secret', 4);
    users.findByUsername.mockResolvedValue({
      id: 'user-1',
      username: 'alice',
      passwordHash,
      active: true,
      authVersion: 2,
      roles: [],
    });
    jwt.signAsync.mockRejectedValueOnce(new Error('signing failed'));
    await expect(service.login({ username: 'alice', password: 'secret' }, 'ip')).rejects.toThrow(
      'signing failed',
    );
    expect(sessions.revoke).toHaveBeenCalledWith(expect.any(String));
  });

  it('authenticates only an active user with matching claims and a live session', async () => {
    users.findById.mockResolvedValue({
      id: 'user-1',
      username: 'alice',
      active: true,
      authVersion: 2,
      roles: ['integration_operator', 'old'],
    });
    await expect(service.authenticate('token')).resolves.toEqual({
      sub: 'user-1',
      sid: 'session-1',
      username: 'alice',
      roles: ['integration_operator'],
    });
    expect(sessions.isActive).toHaveBeenCalledWith('session-1', 'user-1', 2, [
      'integration_operator',
      'old',
    ]);

    for (const user of [
      null,
      { id: 'user-1', active: false, authVersion: 2, roles: [] },
      { id: 'user-1', active: true, authVersion: 3, roles: [] },
    ]) {
      users.findById.mockResolvedValueOnce(user);
      await expect(service.authenticate('token')).rejects.toThrow('Session is no longer active');
    }
    users.findById.mockResolvedValue({
      id: 'user-1',
      username: 'alice',
      active: true,
      authVersion: 2,
      roles: [],
    });
    sessions.isActive.mockResolvedValueOnce(false);
    await expect(service.authenticate('token')).rejects.toThrow('Session is no longer active');
  });

  it('rejects missing, invalid, and incomplete tokens and revokes a valid logout session', async () => {
    await expect(service.authenticate(undefined)).rejects.toThrow('Bearer token is required');
    jwt.verifyAsync.mockRejectedValueOnce(new Error('expired'));
    await expect(service.authenticate('bad')).rejects.toThrow('Invalid or expired token');
    for (const invalid of [
      { ...claims, sub: '' },
      { ...claims, sid: '' },
      { ...claims, authVersion: 1.5 },
    ]) {
      jwt.verifyAsync.mockResolvedValueOnce(invalid);
      await expect(service.authenticate('bad-claims')).rejects.toThrow('Invalid token');
    }
    await service.logout('valid-token');
    expect(sessions.revoke).toHaveBeenCalledWith('session-1');
    jwt.verifyAsync.mockResolvedValueOnce({ ...claims, sid: '' });
    await expect(service.logout('missing-session')).rejects.toThrow('Invalid token');
  });

  it('accepts a bearer header case-insensitively and treats absent or other schemes as missing tokens', async () => {
    const logout = jest.spyOn(service, 'logout').mockResolvedValue(undefined);
    await service.logoutAuthorizationHeader('  bEaReR   token-value  ');
    await service.logoutAuthorizationHeader('Basic credentials');
    await service.logoutAuthorizationHeader(undefined);
    await service.logoutAuthorizationHeader('');
    expect(logout).toHaveBeenNthCalledWith(1, 'token-value');
    expect(logout).toHaveBeenNthCalledWith(2, undefined);
    expect(logout).toHaveBeenNthCalledWith(3, undefined);
    expect(logout).toHaveBeenNthCalledWith(4, undefined);
  });
});
