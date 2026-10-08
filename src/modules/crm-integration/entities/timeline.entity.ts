import { Column, Entity, Index } from 'typeorm';

import { IntegrationBaseEntity } from '@/apps/tiktok/database/base.entity.js';
import { TIKTOK_TABLE_NAMES } from '@/apps/tiktok/database/table-names.js';

@Entity({ name: TIKTOK_TABLE_NAMES.timeline })
@Index('uq_integration_timeline_marker', ['marker'], { unique: true })
@Index('ix_integration_timeline_pending', ['status', 'nextAttemptAt'])
export class TimelineEntity extends IntegrationBaseEntity {
  @Column({ name: 'lead_id', type: 'uuid' })
  leadId!: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 16, default: 'lead' })
  entityType!: 'lead' | 'deal';

  @Column({ name: 'remote_entity_id', type: 'varchar', length: 255, nullable: true })
  remoteEntityId!: string | null;

  @Column({ name: 'remote_timeline_id', type: 'varchar', length: 255, nullable: true })
  remoteTimelineId!: string | null;

  @Column({ type: 'varchar', length: 255 })
  marker!: string;

  @Column({ type: 'text' })
  comment!: string;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status!: 'pending' | 'posted' | 'reconcile_required';

  @Column({ type: 'integer', default: 0 })
  attempt!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ name: 'last_error_code', type: 'varchar', length: 100, nullable: true })
  lastErrorCode!: string | null;
}
