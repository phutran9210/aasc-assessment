import { ApiProperty } from '@nestjs/swagger';

/** Swagger schema of `PaginationMeta`. */
export class PaginationMetaDto {
  @ApiProperty({ description: 'Tổng số bản ghi', example: 101 })
  total: number;

  @ApiProperty({ description: 'Trang hiện tại', example: 1 })
  page: number;

  @ApiProperty({ description: 'Số bản ghi mỗi trang', example: 20 })
  limit: number;

  @ApiProperty({ description: 'Tổng số trang', example: 6 })
  totalPages: number;
}
