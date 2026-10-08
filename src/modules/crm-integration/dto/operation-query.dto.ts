import { IsIn, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '@common/dto/pagination-query.dto.js';
import { OPERATION_STATUSES } from '@core/queue/constants/operation.constants.js';
import type { OperationStatus } from '@core/queue/types/operation.types.js';

export class OperationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(Object.values(OPERATION_STATUSES))
  status?: OperationStatus;
}
