import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateContactDto } from '../dto/create-contact.dto.js';
import { UpdateContactDto } from '../dto/update-contact.dto.js';

const check = async (value: Record<string, unknown>) =>
  validate(plainToInstance(CreateContactDto, value), { whitelist: true });

describe('Contact DTOs', () => {
  it('should reject an empty contact name', async () => {
    expect((await check({ name: '   ' })).length).toBeGreaterThan(0);
  });

  it('should accept a valid email and phone', async () => {
    expect(
      await check({ name: 'Nguyen Van A', email: 'a@example.com', phone: '+84 (90) 123-4567' }),
    ).toEqual([]);
  });

  it('should reject malformed email and phone', async () => {
    expect((await check({ name: 'A', email: 'not-email', phone: '12' })).length).toBeGreaterThan(0);
  });

  it('should reject an incomplete nested address or bank', async () => {
    expect((await check({ name: 'A', address: { ward: 'W' } })).length).toBeGreaterThan(0);
    expect((await check({ name: 'A', bank: { bankName: 'B' } })).length).toBeGreaterThan(0);
  });

  describe('messages', () => {
    /** Every message class-validator reports, including nested address/bank fields. */
    const messages = async (
      dto: typeof CreateContactDto | typeof UpdateContactDto,
      value: Record<string, unknown>,
    ): Promise<string[]> => {
      const errors = await validate(plainToInstance(dto, value), { whitelist: true });
      return errors.flatMap((error) => [
        ...Object.values(error.constraints ?? {}),
        ...(error.children ?? []).flatMap((child) => Object.values(child.constraints ?? {})),
      ]);
    };

    it('should report one Vietnamese message per invalid field', async () => {
      await expect(
        messages(CreateContactDto, {
          phone: 'abc',
          email: 'not-email',
          website: 'ftp://x',
          address: { ward: 'W', district: '', province: 'P' },
          bank: { bankName: 'B' },
        }),
      ).resolves.toEqual([
        'Tên là bắt buộc và không được vượt quá 255 ký tự',
        'Số điện thoại không hợp lệ',
        'Email không hợp lệ',
        'Website phải là URL http hoặc https hợp lệ',
        'Quận/huyện là bắt buộc',
        'Số tài khoản là bắt buộc',
      ]);
    });

    it('should use the same messages when updating', async () => {
      await expect(
        messages(UpdateContactDto, { name: '', email: 'sai', phone: 12 }),
      ).resolves.toEqual([
        'Tên là bắt buộc và không được vượt quá 255 ký tự',
        'Số điện thoại không hợp lệ',
        'Email không hợp lệ',
      ]);
      await expect(messages(UpdateContactDto, {})).resolves.toEqual([]);
    });
  });
});
