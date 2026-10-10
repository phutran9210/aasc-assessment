import { IsArray, IsObject, IsOptional } from 'class-validator';

/**
 * Either `value` holds the configuration document, or the body is a document in the format of the
 * assignment and carries `field_mapping` and `deal_rules` directly.
 */
export class ConfigurationReplaceDto {
  @IsOptional()
  @IsObject()
  value?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  field_mapping?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  deal_rules?: unknown[];
}
