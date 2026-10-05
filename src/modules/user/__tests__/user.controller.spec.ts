import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import { UserController } from '../controllers/user.controller.js';
import type { UpdateProfileDto } from '../dto/index.js';
import type { UserService } from '../services/user.service.js';
import type { UserResponse } from '../types/index.js';

const user = { id: 'user-1', username: 'alice' };
const profile: UserResponse = {
  id: 'user-1',
  username: 'alice',
  email: null,
  nickname: null,
  createdAt: new Date('2026-10-04T15:00:00.000Z'),
  updatedAt: new Date('2026-10-04T15:00:00.000Z'),
};

describe('UserController', () => {
  const userService = {
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
  };
  let controller: UserController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new UserController(userService as unknown as UserService);
  });

  it('should return the logged-in user profile', async () => {
    userService.getProfile.mockResolvedValue(profile);

    await expect(controller.getMe(user)).resolves.toBe(profile);
    expect(userService.getProfile).toHaveBeenCalledWith('user-1');
  });

  it('should update the logged-in user profile', async () => {
    const dto: UpdateProfileDto = { nickname: 'Alice' };
    userService.updateProfile.mockResolvedValue(profile);

    await expect(controller.updateMe(user, dto)).resolves.toBe(profile);
    expect(userService.updateProfile).toHaveBeenCalledWith('user-1', dto);
  });

  it('should resolve CurrentUser from the request metadata', () => {
    const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, UserController, 'getMe') as Record<
      string,
      { factory: (data: unknown, context: unknown) => unknown }
    >;
    const [{ factory }] = Object.values(metadata);
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    };

    expect(factory(undefined, context)).toBe(user);
  });
});
