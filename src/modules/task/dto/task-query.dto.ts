import { PaginationQueryDto } from '@common/dto/index.js';

import { ApiPropertyOptional } from '@nestjs/swagger';

import { IsIn, IsOptional } from 'class-validator';

import { TASK_STATUS_VALUES } from '../constants/index.js';
import type { TaskStatus } from '../constants/index.js';
import { TASK_MESSAGES } from '../messages/index.js';

export class TaskQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Lọc theo trạng thái', enum: TASK_STATUS_VALUES })
  @IsOptional()
  @IsIn(TASK_STATUS_VALUES, { message: TASK_MESSAGES.ERROR.STATUS_INVALID })
  status?: TaskStatus;
}
