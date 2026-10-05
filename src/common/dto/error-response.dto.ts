import { ApiProperty } from '@nestjs/swagger';

/** Swagger schema of `ErrorResponse` (the body produced by `HttpExceptionFilter`). */
export class ErrorResponseDto {
  @ApiProperty({ description: 'HTTP status code', example: 400 })
  statusCode: number;

  @ApiProperty({ description: 'Tên lỗi HTTP', example: 'Bad Request' })
  error: string;

  @ApiProperty({
    description: 'Thông báo lỗi (mảng khi có nhiều lỗi validate)',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: ['Email không hợp lệ'],
  })
  message: string | string[];

  @ApiProperty({ description: 'Đường dẫn request', example: '/contacts' })
  path: string;

  @ApiProperty({
    description: 'Thời điểm xảy ra lỗi (ISO 8601)',
    example: '2026-10-04T15:00:00.000Z',
  })
  timestamp: string;
}
