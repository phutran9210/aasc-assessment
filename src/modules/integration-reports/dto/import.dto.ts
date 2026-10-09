import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/** Multipart fields arrive as text; only the literal words true and false are accepted. */
function toBoolean({ value }: { value: unknown }): unknown {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
}

export class LeadImportOptionsDto {
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  dryRun = true;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  applyRules = false;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  sendFeedback = false;
}

/** A cost import has no options; unknown multipart fields are rejected. */
export class CostImportOptionsDto {}
