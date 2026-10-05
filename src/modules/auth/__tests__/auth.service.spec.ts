import { authConfig } from '@config/index.js';
import type { User } from '@modules/user/entities/user.entity.js';
import { UserService } from '@modules/user/services/user.service.js';

import { UnauthorizedException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';

import bcrypt from 'bcrypt';

import { AuthService } from '../services/auth.service.js';

const SECRET = 'unit-test-secret-0123456789';
const profile = {
  id: 'user-1',
  username: 'alice',
  email: null,
  nickname: null,
  createdAt: new Date('2026-10-04T15:00:00.000Z'),
  updatedAt: new Date('2026-10-04T15:00:00.000Z'),
};

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  const userService = {
    create: jest.fn(),
    findEntityByUsername: jest.fn(),
    getProfile: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: SECRET, signOptions: { expiresIn: 3600 } })],
      providers: [
        AuthService,
        { provide: UserService, useValue: userService },
        {
          provide: authConfig.KEY,
          useValue: { jwtSecret: SECRET, jwtExpiresInSeconds: 3600, bcryptRounds: 4 },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    jwtService = moduleRef.get(JwtService);
  });

  describe('register', () => {
    it('should store a bcrypt hash, never the plain password, when registering', async () => {
      userService.create.mockResolvedValue(profile);

      const result = await service.register({ username: 'alice', password: 'matkhau123' });

      const [{ username, passwordHash }] = userService.create.mock.calls[0] as [
        { username: string; passwordHash: string },
      ];
      expect(result).toBe(profile);
      expect(username).toBe('alice');
      expect(passwordHash).not.toContain('matkhau123');
      expect(passwordHash).toMatch(/^\$2[aby]\$04\$/);
      expect(await bcrypt.compare('matkhau123', passwordHash)).toBe(true);
    });
  });

  describe('login', () => {
    const storedUser = async (): Promise<User> =>
      ({ ...profile, passwordHash: await bcrypt.hash('matkhau123', 4) }) as User;

    it('should return a signed token and the profile when the credentials are correct', async () => {
      userService.findEntityByUsername.mockResolvedValue(await storedUser());
      userService.getProfile.mockResolvedValue(profile);

      const result = await service.login({ username: 'alice', password: 'matkhau123' });

      expect(result).toEqual({
        accessToken: expect.any(String),
        tokenType: 'Bearer',
        expiresIn: 3600,
        user: profile,
      });
      expect(await jwtService.verifyAsync(result.accessToken)).toEqual(
        expect.objectContaining({ sub: 'user-1', username: 'alice' }),
      );
      expect(JSON.stringify(result)).not.toContain('passwordHash');
    });

    it('should throw UnauthorizedException when the password is wrong', async () => {
      userService.findEntityByUsername.mockResolvedValue(await storedUser());

      await expect(service.login({ username: 'alice', password: 'sai-mat-khau' })).rejects.toThrow(
        new UnauthorizedException('Tên đăng nhập hoặc mật khẩu không đúng'),
      );
    });

    it('should give the same error when the username does not exist', async () => {
      userService.findEntityByUsername.mockResolvedValue(null);

      await expect(service.login({ username: 'ghost', password: 'matkhau123' })).rejects.toThrow(
        new UnauthorizedException('Tên đăng nhập hoặc mật khẩu không đúng'),
      );
    });
  });

  describe('verifyToken', () => {
    it('should return the user identity when the token is valid', async () => {
      const token = await jwtService.signAsync({ sub: 'user-1', username: 'alice' });

      expect(await service.verifyToken(token)).toEqual({ id: 'user-1', username: 'alice' });
    });

    it('should throw UnauthorizedException when the token is missing', async () => {
      await expect(service.verifyToken(undefined)).rejects.toThrow(
        new UnauthorizedException('Bạn cần đăng nhập để thực hiện thao tác này'),
      );
    });

    it.each([
      ['malformed', () => Promise.resolve('not-a-jwt')],
      [
        'signed with another secret',
        () => new JwtService({ secret: 'x'.repeat(20) }).signAsync({}),
      ],
      ['expired', () => jwtService.signAsync({ sub: 'user-1' }, { expiresIn: -10 })],
    ])('should throw UnauthorizedException when the token is %s', async (_case, makeToken) => {
      await expect(service.verifyToken(await makeToken())).rejects.toThrow(
        new UnauthorizedException('Phiên đăng nhập không hợp lệ hoặc đã hết hạn'),
      );
    });
  });
});
