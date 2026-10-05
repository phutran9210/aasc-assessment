import { ApiProperty } from '@nestjs/swagger';

import { USER_API_PROPERTIES } from '../constants/index.js';

/** Swagger schema of `UserResponse`. */
export class UserResponseDto {
  @ApiProperty(USER_API_PROPERTIES.id)
  id: string;

  @ApiProperty(USER_API_PROPERTIES.username)
  username: string;

  @ApiProperty(USER_API_PROPERTIES.email)
  email: string | null;

  @ApiProperty(USER_API_PROPERTIES.nickname)
  nickname: string | null;

  @ApiProperty(USER_API_PROPERTIES.createdAt)
  createdAt: Date;

  @ApiProperty(USER_API_PROPERTIES.updatedAt)
  updatedAt: Date;
}
