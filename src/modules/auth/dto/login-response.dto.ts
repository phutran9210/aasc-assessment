import { UserResponseDto } from '@modules/user/dto/index.js';

import { ApiProperty } from '@nestjs/swagger';

/** Swagger schema of `LoginResponse`. */
export class LoginResponseDto {
  @ApiProperty({ description: 'JWT dùng cho header Authorization và kết nối WebSocket' })
  accessToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: string;

  @ApiProperty({ description: 'Thời hạn token (giây)', example: 86400 })
  expiresIn: number;

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;
}
