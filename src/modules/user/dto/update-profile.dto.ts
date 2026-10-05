import { ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, Length, MaxLength } from 'class-validator';

import { USER_API_PROPERTIES, USER_CONSTRAINTS } from '../constants/index.js';
import { USER_MESSAGES } from '../messages/index.js';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimLowerCase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Only email and nickname can be changed. Send `null` to clear a field. */
export class UpdateProfileDto {
  @ApiPropertyOptional(USER_API_PROPERTIES.email)
  @IsOptional()
  @Transform(trimLowerCase)
  @IsEmail({}, { message: USER_MESSAGES.ERROR.EMAIL_INVALID })
  @MaxLength(USER_CONSTRAINTS.EMAIL.MAX_LENGTH, { message: USER_MESSAGES.ERROR.EMAIL_TOO_LONG })
  email?: string | null;

  @ApiPropertyOptional(USER_API_PROPERTIES.nickname)
  @IsOptional()
  @Transform(trimString)
  @Length(USER_CONSTRAINTS.NICKNAME.MIN_LENGTH, USER_CONSTRAINTS.NICKNAME.MAX_LENGTH, {
    message: USER_MESSAGES.ERROR.NICKNAME_INVALID,
  })
  nickname?: string | null;
}
