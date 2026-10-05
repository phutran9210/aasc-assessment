import { ApiList } from '@common/decorators/index.js';
import { ErrorResponseDto } from '@common/dto/index.js';

import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiUnauthorizedResponse } from '@nestjs/swagger';

import { CaroMatchListItemDto } from '../dto/index.js';

export const ApiCaroHistory = () =>
  applyDecorators(
    ApiList('Lịch sử trận Caro của tài khoản đang đăng nhập (phân trang)', CaroMatchListItemDto),
    ApiBearerAuth(),
    ApiUnauthorizedResponse({ description: 'Thiếu hoặc sai access token', type: ErrorResponseDto }),
  );
