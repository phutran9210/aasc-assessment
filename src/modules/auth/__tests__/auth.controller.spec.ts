import { AuthController } from '../controllers/auth.controller.js';
import type { AuthService } from '../services/auth.service.js';
import type { LoginResponse } from '../types/index.js';

const profile = {
  id: 'user-1',
  username: 'alice',
  email: null,
  nickname: null,
  createdAt: new Date('2026-10-04T15:00:00.000Z'),
  updatedAt: new Date('2026-10-04T15:00:00.000Z'),
};

describe('AuthController', () => {
  const authService = {
    register: jest.fn(),
    login: jest.fn(),
  };
  let controller: AuthController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new AuthController(authService as unknown as AuthService);
  });

  it('should delegate registration and return the created profile', async () => {
    authService.register.mockResolvedValue(profile);

    await expect(controller.register({ username: 'alice', password: 'matkhau123' })).resolves.toBe(
      profile,
    );
    expect(authService.register).toHaveBeenCalledWith({
      username: 'alice',
      password: 'matkhau123',
    });
  });

  it('should delegate login and return the token response', async () => {
    const response: LoginResponse = {
      accessToken: 'token',
      tokenType: 'Bearer',
      expiresIn: 3600,
      user: profile,
    };
    authService.login.mockResolvedValue(response);

    await expect(controller.login({ username: 'alice', password: 'matkhau123' })).resolves.toBe(
      response,
    );
    expect(authService.login).toHaveBeenCalledWith({
      username: 'alice',
      password: 'matkhau123',
    });
  });
});
