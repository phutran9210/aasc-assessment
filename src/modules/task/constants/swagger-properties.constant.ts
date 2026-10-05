import type { ApiPropertyOptions } from '@nestjs/swagger';

import { TASK_CONSTRAINTS } from './task-constraints.constant.js';
import { TASK_STATUS_VALUES, TASK_STATUSES } from './task-status.constant.js';

export const TASK_API_PROPERTIES = {
  id: {
    description: 'ID của task (UUID)',
    example: '0199a1b2-c3d4-7e5f-8a6b-0123456789ab',
    type: 'string',
    format: 'uuid',
  },
  title: {
    description: 'Tiêu đề task',
    example: 'Viết tài liệu API',
    type: 'string',
    maxLength: TASK_CONSTRAINTS.TITLE.MAX_LENGTH,
  },
  description: {
    description: 'Mô tả chi tiết',
    example: 'Mô tả các endpoint CRUD bằng Swagger',
    type: 'string',
    nullable: true,
    maxLength: TASK_CONSTRAINTS.DESCRIPTION.MAX_LENGTH,
  },
  status: {
    description: 'Trạng thái task',
    example: TASK_STATUSES.TODO,
    enum: TASK_STATUS_VALUES,
    default: TASK_STATUSES.TODO,
  },
  createdAt: {
    description: 'Thời điểm tạo (ISO 8601)',
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
