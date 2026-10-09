import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { EXPORT_FORMATS } from '../types/report.types.js';
import type { ExportFormat } from '../types/report.types.js';

export class ExportQueryDto {
  @IsOptional()
  @IsIn(EXPORT_FORMATS)
  format: ExportFormat = 'csv';

  @IsOptional()
  @IsIn(['leads'])
  scope = 'leads' as const;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
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

/** Body of an asynchronous export; same filters as the synchronous download. */
export class CreateExportDto extends ExportQueryDto {}
