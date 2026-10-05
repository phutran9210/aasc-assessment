import { ErrorResponseDto } from '@common/dto/index.js';

import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { UserResponseDto } from '../dto/index.js';
import { USER_MESSAGES } from '../messages/index.js';

const authenticated = () =>
  applyDecorators(
    ApiBearerAuth(),
    ApiUnauthorizedResponse({ description: 'Thiếu hoặc sai access token', type: ErrorResponseDto }),
  );

export const ApiUserMe = () =>
  applyDecorators(
    ApiOperation({ summary: 'Lấy thông tin tài khoản đang đăng nhập' }),
    ApiOkResponse({ type: UserResponseDto }),
    authenticated(),
  );

export const ApiUserUpdateMe = () =>
  applyDecorators(
    ApiOperation({ summary: 'Cập nhật email và nickname của tài khoản đang đăng nhập' }),
    ApiOkResponse({ type: UserResponseDto }),
    ApiBadRequestResponse({ description: 'Dữ liệu không hợp lệ', type: ErrorResponseDto }),
    ApiConflictResponse({ description: USER_MESSAGES.ERROR.EMAIL_TAKEN, type: ErrorResponseDto }),
    authenticated(),
  );
