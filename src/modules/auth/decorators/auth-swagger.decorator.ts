import { ErrorResponseDto } from '@common/dto/index.js';
import { UserResponseDto } from '@modules/user/dto/index.js';
import { USER_MESSAGES } from '@modules/user/messages/index.js';

import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { LoginResponseDto } from '../dto/index.js';
import { AUTH_MESSAGES } from '../messages/index.js';

const badRequest = () =>
  ApiBadRequestResponse({ description: 'Dữ liệu không hợp lệ', type: ErrorResponseDto });

export const ApiAuthRegister = () =>
  applyDecorators(
    ApiOperation({ summary: 'Đăng ký tài khoản bằng username và password' }),
    ApiCreatedResponse({ type: UserResponseDto }),
    badRequest(),
    ApiConflictResponse({
      description: USER_MESSAGES.ERROR.USERNAME_TAKEN,
      type: ErrorResponseDto,
    }),
  );

export const ApiAuthLogin = () =>
  applyDecorators(
    ApiOperation({ summary: 'Đăng nhập, nhận JWT access token' }),
    ApiOkResponse({ type: LoginResponseDto }),
    badRequest(),
    ApiUnauthorizedResponse({
      description: AUTH_MESSAGES.ERROR.INVALID_CREDENTIALS,
      type: ErrorResponseDto,
    }),
  );
