import { IsIn, IsInt, IsObject, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import { BITRIX_EVENT_NAMES } from '../constants/index.js';

export class BitrixInstallAuthDto {
  @IsString()
  domain: string;

  @IsString()
  scope: string;

  @IsString()
  access_token: string;

  @IsString()
  refresh_token: string;

  @IsInt()
  expires_in: number;

  @IsString()
  server_endpoint: string;

  @IsString()
  status: string;

  @IsString()
  client_endpoint: string;

  @IsString()
  member_id: string;

  @IsString()
  application_token: string;
}

export class BitrixInstallEventDto {
  @IsIn(BITRIX_EVENT_NAMES)
  event: string;

  @IsObject()
  data: Record<string, unknown>;

  @IsString()
  ts: string;

  @ValidateNested()
  @Type(() => BitrixInstallAuthDto)
  auth: BitrixInstallAuthDto;
}
