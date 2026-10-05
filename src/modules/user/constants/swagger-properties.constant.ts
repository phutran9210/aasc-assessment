import type { ApiPropertyOptions } from '@nestjs/swagger';

import { USER_CONSTRAINTS } from './user-constraints.constant.js';

export const USER_API_PROPERTIES = {
  id: {
    description: 'ID người dùng (UUID)',
    example: '0199a1b2-c3d4-7e5f-8a6b-0123456789ab',
    type: 'string',
    format: 'uuid',
  },
  username: {
    description: 'Tên đăng nhập (chữ, số, gạch dưới; không phân biệt hoa thường)',
    example: 'nguyenvana',
    type: 'string',
    minLength: USER_CONSTRAINTS.USERNAME.MIN_LENGTH,
    maxLength: USER_CONSTRAINTS.USERNAME.MAX_LENGTH,
  },
  password: {
    description: 'Mật khẩu',
    example: 'matkhau123',
    type: 'string',
    minLength: USER_CONSTRAINTS.PASSWORD.MIN_LENGTH,
  },
  email: {
    description: 'Email',
    example: 'nguyenvana@example.com',
    type: 'string',
    format: 'email',
    nullable: true,
  },
  nickname: {
    description: 'Tên hiển thị trong game',
    example: 'Văn A',
    type: 'string',
    nullable: true,
    minLength: USER_CONSTRAINTS.NICKNAME.MIN_LENGTH,
    maxLength: USER_CONSTRAINTS.NICKNAME.MAX_LENGTH,
  },
  createdAt: {
    description: 'Thời điểm đăng ký (ISO 8601)',
    example: '2026-10-04T15:00:00.000Z',
    type: 'string',
    format: 'date-time',
  },
  updatedAt: {
    description: 'Thời điểm cập nhật gần nhất (ISO 8601)',
    example: '2026-10-04T15:00:00.000Z',
    type: 'string',
    format: 'date-time',
  },
} as const satisfies Record<string, ApiPropertyOptions>;
