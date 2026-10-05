import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { TASK_API_PROPERTIES, TASK_CONSTRAINTS, TASK_STATUS_VALUES } from '../constants/index.js';
import type { TaskStatus } from '../constants/index.js';
import { TASK_MESSAGES } from '../messages/index.js';

/** Trims strings so that a whitespace-only title is rejected as empty. */
export const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateTaskDto {
  @ApiProperty(TASK_API_PROPERTIES.title)
  @Transform(trimString)
  @IsString({ message: TASK_MESSAGES.ERROR.TITLE_NOT_STRING })
  @IsNotEmpty({ message: TASK_MESSAGES.ERROR.TITLE_REQUIRED })
  @MaxLength(TASK_CONSTRAINTS.TITLE.MAX_LENGTH, { message: TASK_MESSAGES.ERROR.TITLE_TOO_LONG })
  title: string;

  @ApiPropertyOptional(TASK_API_PROPERTIES.description)
  @IsOptional()
  @Transform(trimString)
  @IsString({ message: TASK_MESSAGES.ERROR.DESCRIPTION_NOT_STRING })
  @MaxLength(TASK_CONSTRAINTS.DESCRIPTION.MAX_LENGTH, {
    message: TASK_MESSAGES.ERROR.DESCRIPTION_TOO_LONG,
  })
  description?: string | null;

  @ApiPropertyOptional(TASK_API_PROPERTIES.status)
  @IsOptional()
  @IsIn(TASK_STATUS_VALUES, { message: TASK_MESSAGES.ERROR.STATUS_INVALID })
  status?: TaskStatus;
}
