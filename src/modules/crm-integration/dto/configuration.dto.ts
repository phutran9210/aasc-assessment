import { IsObject } from 'class-validator';

export class ConfigurationReplaceDto {
  @IsObject()
  value!: Record<string, unknown>;
}
