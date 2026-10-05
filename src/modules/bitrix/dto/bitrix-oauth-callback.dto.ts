import { IsOptional, IsString } from 'class-validator';

export class BitrixOAuthCallbackDto {
  @IsString()
  code: string;

  @IsOptional()
  @IsString()
  state?: string;
}
