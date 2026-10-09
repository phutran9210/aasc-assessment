import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '@common/dto/pagination-query.dto.js';

// Bounds are parsed by the period resolver: it knows the endpoint's day-alignment rules.
const BOUND_MAX_LENGTH = 40;

export class ConversionRatesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(BOUND_MAX_LENGTH)
  from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(BOUND_MAX_LENGTH)
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  date_range?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  campaign_id?: string;
}

export class CampaignPerformanceQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(BOUND_MAX_LENGTH)
  from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(BOUND_MAX_LENGTH)
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  date_range?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  campaign_id?: string;

  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a three-letter ISO 4217 code' })
  currency?: string;
}
