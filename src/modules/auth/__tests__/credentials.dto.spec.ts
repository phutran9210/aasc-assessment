import { UpdateProfileDto } from '@modules/user/dto/index.js';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CredentialsDto } from '../dto/index.js';

async function messagesOf<T extends object>(dto: new () => T, body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(dto, body));
  return [...new Set(errors.flatMap((error) => Object.values(error.constraints ?? {})))];
}

const USERNAME_ERROR = 'username phải dài 3-30 ký tự và chỉ gồm chữ, số, dấu gạch dưới';

describe('CredentialsDto', () => {
  it('should accept valid credentials and lower-case the username', async () => {
    const dto = plainToInstance(CredentialsDto, {
      username: '  Alice_01 ',
      password: 'matkhau123',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.username).toBe('alice_01');
  });

  it('should keep the password exactly as typed, including spaces', () => {
    const dto = plainToInstance(CredentialsDto, { username: 'alice', password: '  Mật khẩu 1  ' });

    expect(dto.password).toBe('  Mật khẩu 1  ');
  });

  it.each([
    ['ab'],
    ['a'.repeat(31)],
    ['có dấu'],
    ['a b'],
    ['alice!'],
    [''],
    [123],
    [null],
    [undefined],
  ])('should reject username %p', async (username) => {
    expect(await messagesOf(CredentialsDto, { username, password: 'matkhau123' })).toEqual([
      USERNAME_ERROR,
    ]);
  });

  it('should reject a password shorter than 8 characters', async () => {
    expect(await messagesOf(CredentialsDto, { username: 'alice', password: '1234567' })).toEqual([
      'password phải có ít nhất 8 ký tự',
    ]);
  });

  it('should accept a 72-byte password and reject a 73-byte one', async () => {
    expect(
      await messagesOf(CredentialsDto, { username: 'alice', password: 'a'.repeat(72) }),
    ).toEqual([]);
    expect(
      await messagesOf(CredentialsDto, { username: 'alice', password: 'a'.repeat(73) }),
    ).toEqual(['password không được vượt quá 72 byte']);
  });

  it('should count bytes, not characters, when the password has multi-byte characters', async () => {
    // "ệ" is 3 bytes in UTF-8: 25 characters = 75 bytes.
    expect(
      await messagesOf(CredentialsDto, { username: 'alice', password: 'ệ'.repeat(25) }),
    ).toEqual(['password không được vượt quá 72 byte']);
  });

  it('should reject a password that is not a string', async () => {
    expect(await messagesOf(CredentialsDto, { username: 'alice', password: 12345678 })).toContain(
      'password phải là chuỗi',
    );
  });
});

describe('UpdateProfileDto', () => {
  it('should accept an empty body, nulls, and valid values', async () => {
    expect(await messagesOf(UpdateProfileDto, {})).toEqual([]);
    expect(await messagesOf(UpdateProfileDto, { email: null, nickname: null })).toEqual([]);
    expect(await messagesOf(UpdateProfileDto, { email: 'a@b.vn', nickname: 'Văn A' })).toEqual([]);
  });

  it('should trim and lower-case the email and trim the nickname', () => {
    const dto = plainToInstance(UpdateProfileDto, {
      email: ' A@Example.COM ',
      nickname: '  Văn A ',
    });

    expect(dto).toEqual({ email: 'a@example.com', nickname: 'Văn A' });
  });

  it.each(['not-an-email', 'a@', '@b.vn', 'a b@c.vn'])(
    'should reject email "%s"',
    async (email) => {
      expect(await messagesOf(UpdateProfileDto, { email })).toEqual(['Email không hợp lệ']);
    },
  );

  it.each(['a', ' a ', 'a'.repeat(31)])('should reject nickname "%s"', async (nickname) => {
    expect(await messagesOf(UpdateProfileDto, { nickname })).toEqual([
      'nickname phải dài 2-30 ký tự',
    ]);
  });
});
