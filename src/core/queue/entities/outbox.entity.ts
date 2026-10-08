import { Column, Entity, Index } from 'typeorm';

import { IntegrationBaseEntity } from '../../../apps/tiktok/database/base.entity.js';
import { TIKTOK_TABLE_NAMES } from '../../../apps/tiktok/database/table-names.js';

@Entity({ name: TIKTOK_TABLE_NAMES.outbox })
@Index('uq_integration_outbox_job_key', ['jobKey'], { unique: true })
@Index('ix_integration_outbox_available', ['publishedAt', 'availableAt'])
export class OutboxEntity extends IntegrationBaseEntity {
  @Column({ name: 'operation_id', type: 'uuid' })
  operationId!: string;

  @Column({ type: 'varchar', length: 64 })
  queue!: string;

  @Column({ name: 'dispatch_generation', type: 'integer', default: 1 })
  dispatchGeneration!: number;

  @Column({ name: 'job_key', type: 'varchar', length: 300 })
  jobKey!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, string>;

  @Column({ name: 'available_at', type: 'timestamptz', default: () => 'now()' })
  availableAt!: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true })
  leaseUntil!: Date | null;

  @Column({ name: 'lease_owner', type: 'uuid', nullable: true, select: false })
  leaseOwner!: string | null;
}
