import { ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

import { TASK_API_PROPERTIES, TASK_CONSTRAINTS, TASK_STATUS_VALUES } from '../constants/index.js';
import type { TaskStatus } from '../constants/index.js';
import { TASK_MESSAGES } from '../messages/index.js';
import { trimString } from './create-task.dto.js';

/** Skips validation only when the field is absent; an explicit `null` is still validated. */
const isProvided = (_: object, value: unknown): boolean => value !== undefined;

/** Partial update: only the fields present in the body are changed. */
export class UpdateTaskDto {
  @ApiPropertyOptional(TASK_API_PROPERTIES.title)
  // Not @IsOptional(): it would let `title: null` through to a NOT NULL column.
  @ValidateIf(isProvided)
  @Transform(trimString)
  @IsString({ message: TASK_MESSAGES.ERROR.TITLE_NOT_STRING })
  @IsNotEmpty({ message: TASK_MESSAGES.ERROR.TITLE_REQUIRED })
  @MaxLength(TASK_CONSTRAINTS.TITLE.MAX_LENGTH, { message: TASK_MESSAGES.ERROR.TITLE_TOO_LONG })
  title?: string;

  @ApiPropertyOptional(TASK_API_PROPERTIES.description)
  // @IsOptional() on purpose: `description: null` clears the description.
  @IsOptional()
  @Transform(trimString)
  @IsString({ message: TASK_MESSAGES.ERROR.DESCRIPTION_NOT_STRING })
  @MaxLength(TASK_CONSTRAINTS.DESCRIPTION.MAX_LENGTH, {
    message: TASK_MESSAGES.ERROR.DESCRIPTION_TOO_LONG,
  })
  description?: string | null;

  @ApiPropertyOptional(TASK_API_PROPERTIES.status)
  @ValidateIf(isProvided)
  @IsIn(TASK_STATUS_VALUES, { message: TASK_MESSAGES.ERROR.STATUS_INVALID })
  status?: TaskStatus;
}
