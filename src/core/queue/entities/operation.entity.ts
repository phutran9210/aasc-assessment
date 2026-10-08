import { Column, Entity, Index } from 'typeorm';

import { IntegrationBaseEntity } from '../../../apps/tiktok/database/base.entity.js';
import { TIKTOK_TABLE_NAMES } from '../../../apps/tiktok/database/table-names.js';
import type {
  OperationKind,
  OperationPayload,
  OperationStatus,
  RevisionSet,
} from '../../../modules/crm-integration/types/integration.types.js';

@Entity({ name: TIKTOK_TABLE_NAMES.operation })
@Index('uq_integration_operation_key', ['operationKey'], { unique: true })
@Index('ix_integration_operation_status_next_attempt', ['status', 'nextAttemptAt'])
@Index('ix_integration_operation_aggregate_version', ['aggregateId', 'targetVersion'])
export class OperationEntity extends IntegrationBaseEntity {
  @Column({ name: 'operation_key', type: 'varchar', length: 512 })
  operationKey!: string;

  @Column({ type: 'varchar', length: 64 })
  kind!: OperationKind;

  @Column({ name: 'aggregate_id', type: 'uuid', nullable: true })
  aggregateId!: string | null;

  @Column({ name: 'target_version', type: 'integer', nullable: true })
  targetVersion!: number | null;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status!: OperationStatus;

  @Column({ type: 'integer', default: 0 })
  attempt!: number;

  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true })
  leaseUntil!: Date | null;

  @Column({ name: 'lease_token', type: 'uuid', nullable: true, select: false })
  leaseToken!: string | null;

  @Column({ name: 'remote_id', type: 'varchar', length: 255, nullable: true })
  remoteId!: string | null;

  @Column({ name: 'last_error_code', type: 'varchar', length: 100, nullable: true })
  lastErrorCode!: string | null;

  @Column({ name: 'last_error_detail', type: 'text', nullable: true })
  lastErrorDetail!: string | null;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: OperationPayload;

  @Column({ name: 'config_revisions', type: 'jsonb', default: () => "'{}'::jsonb" })
  configRevisions!: Partial<RevisionSet>;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}
