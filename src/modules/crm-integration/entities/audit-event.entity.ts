import { Column, Entity, Index } from 'typeorm';

import { IntegrationBaseEntity } from '../../../apps/tiktok/database/base.entity.js';
import { TIKTOK_TABLE_NAMES } from '../../../apps/tiktok/database/table-names.js';

@Entity({ name: TIKTOK_TABLE_NAMES.auditEvent })
@Index('ix_integration_audit_scope_created', ['scopeKey', 'createdAt'])
@Index('ix_integration_audit_actor_created', ['actorId', 'createdAt'])
export class AuditEventEntity extends IntegrationBaseEntity {
  @Column({ name: 'scope_key', type: 'varchar', length: 255 })
  scopeKey!: string;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType!: string;

  @Column({ name: 'aggregate_type', type: 'varchar', length: 64, nullable: true })
  aggregateType!: string | null;

  @Column({ name: 'aggregate_id', type: 'uuid', nullable: true })
  aggregateId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;
}
