import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto.js';

export class LeadQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['tiktok'])
  source = 'tiktok';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  campaign_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  sync_status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  business_status?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsIn(['createdAt'])
  timeBasis = 'createdAt' as const;
}
