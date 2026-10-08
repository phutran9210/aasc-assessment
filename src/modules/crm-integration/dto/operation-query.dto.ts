import { IsIn, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto.js';

const OPERATION_STATUSES = [
  'pending',
  'processing',
  'retry_wait',
  'reconcile_required',
  'quarantined',
  'succeeded',
  'dead_letter',
  'cancelled',
] as const;

export class OperationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(OPERATION_STATUSES)
  status?: (typeof OPERATION_STATUSES)[number];
}
