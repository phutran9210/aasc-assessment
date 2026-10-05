import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { DataSource } from 'typeorm';

import { User } from '../entities/user.entity.js';
import { UserRepository } from '../repositories/user.repository.js';
import { UserService } from '../services/user.service.js';

/** Runs against a real in-memory SQLite database so the unique indexes are exercised too. */
describe('UserService', () => {
  let dataSource: DataSource;
  let service: UserService;

  const register = (username: string) => service.create({ username, passwordHash: 'hash' });

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [User],
      synchronize: true,
    });
    await dataSource.initialize();
    const moduleRef = await Test.createTestingModule({
      providers: [UserService, UserRepository, { provide: DataSource, useValue: dataSource }],
    }).compile();
    service = moduleRef.get(UserService);
  });

  afterEach(async () => {
    await dataSource.destroy();
    jest.restoreAllMocks();
  });

  describe('create', () => {
    it('should return the profile without the password hash when the username is free', async () => {
      const user = await register('alice');

      expect(user).toEqual({
        id: expect.any(String),
        username: 'alice',
        email: null,
        nickname: null,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
      expect(user).not.toHaveProperty('passwordHash');
    });

    it('should throw ConflictException when the username is taken', async () => {
      await register('alice');

      await expect(register('alice')).rejects.toThrow(
        new ConflictException('Tên đăng nhập đã tồn tại'),
      );
    });

    it('should throw ConflictException when two registrations race for the same username', async () => {
      const results = await Promise.allSettled([register('bob'), register('bob')]);

      const rejected = results.filter((result) => result.status === 'rejected');
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    });
  });

  describe('findEntityByUsername', () => {
    it('should return the entity with its hash when the user exists', async () => {
      await register('alice');

      expect(await service.findEntityByUsername('alice')).toEqual(
        expect.objectContaining({ username: 'alice', passwordHash: 'hash' }),
      );
    });

    it('should return null when the user does not exist', async () => {
      expect(await service.findEntityByUsername('nobody')).toBeNull();
    });
  });

  describe('getProfile', () => {
    it('should throw NotFoundException when the user does not exist', async () => {
      await expect(service.getProfile('missing')).rejects.toThrow(
        new NotFoundException('Người dùng không tồn tại'),
      );
    });
  });

  describe('updateProfile', () => {
    it('should change only the provided fields when the dto is partial', async () => {
      const { id } = await register('alice');
      await service.updateProfile(id, { email: 'alice@example.com', nickname: 'Alice' });

      const updated = await service.updateProfile(id, { nickname: 'Ali' });

      expect(updated).toEqual(
        expect.objectContaining({ username: 'alice', email: 'alice@example.com', nickname: 'Ali' }),
      );
    });

    it.each([[null], ['']])('should clear email and nickname when they are %p', async (empty) => {
      const { id } = await register('alice');
      await service.updateProfile(id, { email: 'alice@example.com', nickname: 'Alice' });

      const updated = await service.updateProfile(id, { email: empty, nickname: empty });

      expect(updated.email).toBeNull();
      expect(updated.nickname).toBeNull();
    });

    it('should throw ConflictException when the email belongs to another user', async () => {
      const alice = await register('alice');
      const bob = await register('bob');
      await service.updateProfile(alice.id, { email: 'shared@example.com' });

      await expect(service.updateProfile(bob.id, { email: 'shared@example.com' })).rejects.toThrow(
        new ConflictException('Email đã được sử dụng'),
      );
    });

    it('should accept the same email again when the user re-submits their own', async () => {
      const { id } = await register('alice');
      await service.updateProfile(id, { email: 'alice@example.com' });

      await expect(service.updateProfile(id, { email: 'alice@example.com' })).resolves.toEqual(
        expect.objectContaining({ email: 'alice@example.com' }),
      );
    });

    it('should let several users have no email', async () => {
      const alice = await register('alice');
      const bob = await register('bob');

      await service.updateProfile(alice.id, { email: null });

      await expect(service.updateProfile(bob.id, { email: null })).resolves.toEqual(
        expect.objectContaining({ email: null }),
      );
    });

    it('should throw NotFoundException when the user does not exist', async () => {
      await expect(service.updateProfile('missing', { nickname: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
