import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export const OPERATION_RESOLVE_ACTIONS = [
  'link_remote',
  'select_identity_target',
  'confirm_remote_absent',
  'reprocess_with_current_config',
] as const;

export type ResolveOperationAction = (typeof OPERATION_RESOLVE_ACTIONS)[number];

export class OperationResolveDto {
  @IsIn(OPERATION_RESOLVE_ACTIONS)
  action!: ResolveOperationAction;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remoteId?: string;

  @IsOptional()
  @IsString()
  @IsUUID('7')
  @MaxLength(255)
  targetLeadId?: string;

  @IsOptional()
  @IsObject()
  identityTargets?: Record<string, unknown>;
}
