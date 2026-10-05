import { USER_API_PROPERTIES, USER_CONSTRAINTS } from '@modules/user/constants/index.js';
import { USER_MESSAGES } from '@modules/user/messages/index.js';

import { ApiProperty } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsString, Length, Matches, MinLength } from 'class-validator';

import { MaxByteLength } from '../decorators/max-byte-length.decorator.js';

const { USERNAME, PASSWORD } = USER_CONSTRAINTS;

/** Usernames are case-insensitive: "Alice" and "alice" are the same account. */
const normalizeUsername = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Body of both register and login. The password is never trimmed or altered. */
export class CredentialsDto {
  @ApiProperty(USER_API_PROPERTIES.username)
  @Transform(normalizeUsername)
  @IsString({ message: USER_MESSAGES.ERROR.USERNAME_INVALID })
  @Length(USERNAME.MIN_LENGTH, USERNAME.MAX_LENGTH, {
    message: USER_MESSAGES.ERROR.USERNAME_INVALID,
  })
  @Matches(USERNAME.PATTERN, { message: USER_MESSAGES.ERROR.USERNAME_INVALID })
  username: string;

  @ApiProperty(USER_API_PROPERTIES.password)
  @IsString({ message: USER_MESSAGES.ERROR.PASSWORD_NOT_STRING })
  @MinLength(PASSWORD.MIN_LENGTH, { message: USER_MESSAGES.ERROR.PASSWORD_TOO_SHORT })
  @MaxByteLength(PASSWORD.MAX_BYTES, { message: USER_MESSAGES.ERROR.PASSWORD_TOO_LONG })
  password: string;
}
