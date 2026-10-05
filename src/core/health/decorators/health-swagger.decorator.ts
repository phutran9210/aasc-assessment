import { ErrorResponseDto } from '@common/dto/index.js';

import { applyDecorators } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse } from '@nestjs/swagger';

import { HealthResponseDto } from '../dto/index.js';
import { HEALTH_MESSAGES } from '../messages/index.js';

export const ApiHealthCheck = (): MethodDecorator =>
  applyDecorators(
    ApiOperation({ summary: 'Kiểm tra trạng thái ứng dụng và cơ sở dữ liệu' }),
    ApiOkResponse({ type: HealthResponseDto }),
    ApiServiceUnavailableResponse({
      description: HEALTH_MESSAGES.ERROR.DATABASE_DOWN,
      type: ErrorResponseDto,
    }),
  );
