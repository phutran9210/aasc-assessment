import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { QueryFailedError } from 'typeorm';

import { UpdateProfileDto } from '../dto/index.js';
import type { User } from '../entities/user.entity.js';
import { USER_MESSAGES } from '../messages/index.js';
import { UserRepository } from '../repositories/user.repository.js';
import type { UserResponse } from '../types/index.js';

type NewUser = { username: string; passwordHash: string };

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private readonly userRepository: UserRepository) {}

  /** Creates an account. The caller hashes the password; this service never sees plain text. */
  async create(data: NewUser): Promise<UserResponse> {
    if (await this.userRepository.findByUsername(data.username)) {
      throw new ConflictException(USER_MESSAGES.ERROR.USERNAME_TAKEN);
    }

    const user = await this.saveOrConflict(
      () => this.userRepository.create({ ...data, email: null, nickname: null }),
      USER_MESSAGES.ERROR.USERNAME_TAKEN,
    );
    this.logger.log(`${USER_MESSAGES.SUCCESS.CREATED} (id=${user.id})`);
    return this.toResponse(user);
  }

  /** For authentication only: returns the entity, including the password hash. */
  findEntityByUsername(username: string): Promise<User | null> {
    return this.userRepository.findByUsername(username);
  }

  async getProfile(id: string): Promise<UserResponse> {
    return this.toResponse(await this.findOrFail(id));
  }

  async updateProfile(id: string, dto: UpdateProfileDto): Promise<UserResponse> {
    const user = await this.findOrFail(id);

    if (dto.email !== undefined) {
      const email = dto.email ? dto.email : null;
      if (email && email !== user.email) await this.assertEmailIsFree(email, id);
      user.email = email;
    }
    if (dto.nickname !== undefined) user.nickname = dto.nickname ? dto.nickname : null;

    const saved = await this.saveOrConflict(
      () => this.userRepository.save(user),
      USER_MESSAGES.ERROR.EMAIL_TAKEN,
    );
    this.logger.log(`${USER_MESSAGES.SUCCESS.PROFILE_UPDATED} (id=${id})`);
    return this.toResponse(saved);
  }

  // ── Private Helpers ──

  private async findOrFail(id: string): Promise<User> {
    const user = await this.userRepository.findById(id);
    if (!user) throw new NotFoundException(USER_MESSAGES.ERROR.NOT_FOUND);
    return user;
  }

  private async assertEmailIsFree(email: string, ownerId: string): Promise<void> {
    const owner = await this.userRepository.findByEmail(email);
    if (owner && owner.id !== ownerId) {
      throw new ConflictException(USER_MESSAGES.ERROR.EMAIL_TAKEN);
    }
  }

  /**
   * The checks above are not atomic: two concurrent requests can both pass them. The unique
   * index is the real guard, so its violation is translated into the same 409.
   */
  private async saveOrConflict(save: () => Promise<User>, message: string): Promise<User> {
    try {
      return await save();
    } catch (error) {
      if (error instanceof QueryFailedError && /UNIQUE constraint failed/i.test(error.message)) {
        throw new ConflictException(message);
      }
      throw error;
    }
  }

  private toResponse(user: User): UserResponse {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      nickname: user.nickname,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
