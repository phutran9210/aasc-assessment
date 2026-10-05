import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsOptional, IsUrl, Matches, ValidateIf, ValidateNested } from 'class-validator';

import { CONTACT_PHONE_PATTERN } from '../constants/index.js';
import { CONTACT_MESSAGES } from '../messages/index.js';
import {
  ContactAddressDto,
  ContactBankDto,
  RequiredContactText,
  trimContactString,
} from './create-contact.dto.js';

const { VALIDATION } = CONTACT_MESSAGES;

/** Unlike `@IsOptional`, an explicit `null` is still validated (and rejected). */
const provided = (_object: object, value: unknown): boolean => value !== undefined;

/** Body of `PUT /contacts/:id`. Every field is optional; only the given ones are changed. */
export class UpdateContactDto {
  @ApiPropertyOptional()
  @ValidateIf(provided)
  @Transform(trimContactString)
  @RequiredContactText(VALIDATION.NAME)
  name?: string;

  @ApiPropertyOptional()
  @ValidateIf(provided)
  @Matches(CONTACT_PHONE_PATTERN, { message: VALIDATION.PHONE })
  phone?: string;

  @ApiPropertyOptional()
  @ValidateIf(provided)
  @IsEmail({}, { message: VALIDATION.EMAIL })
  email?: string;

  @ApiPropertyOptional()
  @ValidateIf(provided)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { message: VALIDATION.WEBSITE })
  website?: string;

  @ApiPropertyOptional({ type: ContactAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContactAddressDto)
  address?: ContactAddressDto;

  @ApiPropertyOptional({ type: ContactBankDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContactBankDto)
  bank?: ContactBankDto;
}
