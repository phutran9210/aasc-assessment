import { ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { PAGINATION } from '../constants/index.js';

/** Base class for every list endpoint query: `?page=1&limit=20`. */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Số trang (bắt đầu từ 1)',
    minimum: 1,
    default: PAGINATION.DEFAULT_PAGE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page phải là số nguyên' })
  @Min(1, { message: 'page phải lớn hơn hoặc bằng 1' })
  page: number = PAGINATION.DEFAULT_PAGE;

  @ApiPropertyOptional({
    description: 'Số bản ghi mỗi trang',
    minimum: 1,
    maximum: PAGINATION.MAX_LIMIT,
    default: PAGINATION.DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên' })
  @Min(1, { message: 'limit phải lớn hơn hoặc bằng 1' })
  @Max(PAGINATION.MAX_LIMIT, { message: `limit không được vượt quá ${PAGINATION.MAX_LIMIT}` })
  limit: number = PAGINATION.DEFAULT_LIMIT;
}
