import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsOptional, IsUrl, Length, Matches, ValidateNested } from 'class-validator';

import { CONTACT_PHONE_PATTERN, CONTACT_TEXT_MAX_LENGTH } from '../constants/index.js';
import { CONTACT_MESSAGES } from '../messages/index.js';

const { VALIDATION } = CONTACT_MESSAGES;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * A required text field: `@Length` alone rejects missing, non-string, empty and over-long values,
 * so each invalid field produces exactly one message.
 */
const RequiredText = (message: string): PropertyDecorator =>
  Length(1, CONTACT_TEXT_MAX_LENGTH, { message });

/** Address as used in Vietnam: ward, district and province are all required when given. */
export class ContactAddressDto {
  @ApiProperty() @Transform(trim) @RequiredText(VALIDATION.WARD) ward: string;
  @ApiProperty() @Transform(trim) @RequiredText(VALIDATION.DISTRICT) district: string;
  @ApiProperty() @Transform(trim) @RequiredText(VALIDATION.PROVINCE) province: string;
}

export class ContactBankDto {
  @ApiProperty() @Transform(trim) @RequiredText(VALIDATION.BANK_NAME) bankName: string;
  @ApiProperty() @Transform(trim) @RequiredText(VALIDATION.ACCOUNT_NUMBER) accountNumber: string;
}

/** Body of `POST /contacts`. Only the name is required. */
export class CreateContactDto {
  @ApiProperty() @Transform(trim) @RequiredText(VALIDATION.NAME) name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CONTACT_PHONE_PATTERN, { message: VALIDATION.PHONE })
  phone?: string;

  @ApiPropertyOptional() @IsOptional() @IsEmail({}, { message: VALIDATION.EMAIL }) email?: string;

  @ApiPropertyOptional({ description: 'HTTP/HTTPS URL' })
  @IsOptional()
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

export const trimContactString = trim;
export const RequiredContactText = RequiredText;
