import { ApiProperty } from '@nestjs/swagger';

import { TASK_API_PROPERTIES } from '../constants/index.js';
import type { TaskStatus } from '../constants/index.js';

/** Swagger schema of `TaskListItem`. */
export class TaskListItemDto {
  @ApiProperty(TASK_API_PROPERTIES.id)
  id: string;

  @ApiProperty(TASK_API_PROPERTIES.title)
  title: string;

  @ApiProperty(TASK_API_PROPERTIES.description)
  description: string | null;

  @ApiProperty(TASK_API_PROPERTIES.status)
  status: TaskStatus;

  @ApiProperty(TASK_API_PROPERTIES.createdAt)
  createdAt: Date;
}

/** Swagger schema of `TaskResponse`. */
export class TaskResponseDto extends TaskListItemDto {
  @ApiProperty(TASK_API_PROPERTIES.updatedAt)
  updatedAt: Date;
}
