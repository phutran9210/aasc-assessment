import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '@common/dto/pagination-query.dto.js';

export class DealQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['open', 'won', 'lost'])
  status?: 'open' | 'won' | 'lost';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  assigned_to?: string;
}
