import type { ApiPropertyOptions } from '@nestjs/swagger';

export const HEALTH_API_PROPERTIES = {
  status: { description: 'Trạng thái ứng dụng', example: 'ok', type: 'string' },
  database: { description: 'Trạng thái kết nối cơ sở dữ liệu', example: 'up', type: 'string' },
  uptime: { description: 'Thời gian ứng dụng đã chạy (giây)', example: 123.45, type: 'number' },
  timestamp: {
    description: 'Thời điểm kiểm tra (ISO 8601)',
    example: '2026-10-04T15:00:00.000Z',
    type: 'string',
  },
} as const satisfies Record<string, ApiPropertyOptions>;
