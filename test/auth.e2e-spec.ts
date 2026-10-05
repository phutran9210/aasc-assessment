import type { NestExpressApplication } from '@nestjs/platform-express';

import request from 'supertest';
import { DataSource } from 'typeorm';

import { User } from '../src/modules/user/entities/user.entity.js';
import { createTestApp } from './utils/create-test-app.js';

describe('Auth & Users (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  const http = () => request(app.getHttpServer());
  const credentials = { username: 'alice', password: 'matkhau123' };

  async function loginAs(username = 'alice'): Promise<string> {
    await http().post('/auth/register').send({ username, password: 'matkhau123' }).expect(201);
    const response = await http()
      .post('/auth/login')
      .send({ username, password: 'matkhau123' })
      .expect(200);
    return response.body.accessToken as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await dataSource.getRepository(User).clear();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/register', () => {
    it('should create the account and never return or store the plain password', async () => {
      const response = await http().post('/auth/register').send(credentials).expect(201);

      expect(response.body).toEqual({
        id: expect.any(String),
        username: 'alice',
        email: null,
        nickname: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      const stored = await dataSource.getRepository(User).findOneByOrFail({ username: 'alice' });
      expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
      expect(stored.passwordHash).not.toContain('matkhau123');
    });

    it('should return 409 when the username exists, ignoring letter case', async () => {
      await http().post('/auth/register').send(credentials).expect(201);

      const response = await http()
        .post('/auth/register')
        .send({ username: 'ALICE', password: 'matkhau456' })
        .expect(409);

      expect(response.body.message).toBe('Tên đăng nhập đã tồn tại');
    });

    it('should return 400 with Vietnamese messages when the body is invalid', async () => {
      const response = await http()
        .post('/auth/register')
        .send({ username: 'a', password: '123' })
        .expect(400);

      expect(response.body.message).toEqual([
        'username phải dài 3-30 ký tự và chỉ gồm chữ, số, dấu gạch dưới',
        'password phải có ít nhất 8 ký tự',
      ]);
    });
  });

  describe('POST /auth/login', () => {
    it('should return a bearer token when the credentials are correct', async () => {
      await http().post('/auth/register').send(credentials).expect(201);

      const response = await http().post('/auth/login').send(credentials).expect(200);

      expect(response.body).toEqual({
        accessToken: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/),
        tokenType: 'Bearer',
        expiresIn: 86400,
        user: expect.objectContaining({ username: 'alice' }),
      });
    });

    it.each([
      ['the password is wrong', { username: 'alice', password: 'sai-mat-khau' }],
      ['the user does not exist', { username: 'ghost', password: 'matkhau123' }],
    ])('should return the same 401 when %s', async (_case, body) => {
      await http().post('/auth/register').send(credentials).expect(201);

      const response = await http().post('/auth/login').send(body).expect(401);

      expect(response.body.message).toBe('Tên đăng nhập hoặc mật khẩu không đúng');
    });
  });

  describe('GET /users/me', () => {
    it('should return the profile of the token owner', async () => {
      const token = await loginAs();

      const response = await http()
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.username).toBe('alice');
      expect(response.body).not.toHaveProperty('passwordHash');
    });

    it.each([
      ['there is no token', undefined, 'Bạn cần đăng nhập để thực hiện thao tác này'],
      [
        'the token is garbage',
        'Bearer abc.def.ghi',
        'Phiên đăng nhập không hợp lệ hoặc đã hết hạn',
      ],
    ])('should return 401 when %s', async (_case, header, message) => {
      const call = http().get('/users/me');
      if (header) void call.set('Authorization', header);

      const response = await call.expect(401);

      expect(response.body.message).toBe(message);
    });
  });

  describe('PATCH /users/me', () => {
    it('should update email and nickname when logged in', async () => {
      const token = await loginAs();

      const response = await http()
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'Alice@Example.com', nickname: 'Văn A' })
        .expect(200);

      expect(response.body).toEqual(
        expect.objectContaining({
          username: 'alice',
          email: 'alice@example.com',
          nickname: 'Văn A',
        }),
      );
    });

    it('should return 401 and change nothing when not logged in', async () => {
      await loginAs();

      await http().patch('/users/me').send({ nickname: 'Hacker' }).expect(401);

      const stored = await dataSource.getRepository(User).findOneByOrFail({ username: 'alice' });
      expect(stored.nickname).toBeNull();
    });

    it('should return 400 when trying to change a field that is not allowed', async () => {
      const token = await loginAs();

      const response = await http()
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ username: 'root', passwordHash: 'x' })
        .expect(400);

      expect(response.body.message).toEqual([
        'property username should not exist',
        'property passwordHash should not exist',
      ]);
    });

    it('should return 409 when the email is used by another account', async () => {
      const alice = await loginAs('alice');
      const bob = await loginAs('bob');
      await http()
        .patch('/users/me')
        .set('Authorization', `Bearer ${alice}`)
        .send({ email: 'shared@example.com' })
        .expect(200);

      const response = await http()
        .patch('/users/me')
        .set('Authorization', `Bearer ${bob}`)
        .send({ email: 'shared@example.com' })
        .expect(409);

      expect(response.body.message).toBe('Email đã được sử dụng');
    });

    it('should return 400 when the email is malformed', async () => {
      const token = await loginAs();

      const response = await http()
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'not-an-email' })
        .expect(400);

      expect(response.body.message).toEqual(['Email không hợp lệ']);
    });
  });
});
