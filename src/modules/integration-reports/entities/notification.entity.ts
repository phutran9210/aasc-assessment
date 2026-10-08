import { Column, Entity, Index } from 'typeorm';

import { IntegrationBaseEntity } from '@/apps/tiktok/database/base.entity.js';

@Entity({ name: 'integration_notification' })
@Index('uq_integration_notification_dedup_key', ['dedupKey'], { unique: true })
@Index('ix_integration_notification_recipient_created', ['recipientId', 'createdAt'])
export class NotificationEntity extends IntegrationBaseEntity {
  @Column({ name: 'dedup_key', type: 'varchar', length: 512 })
  dedupKey!: string;

  @Column({ type: 'varchar', length: 100 })
  type!: string;

  @Column({ name: 'recipient_id', type: 'uuid', nullable: true })
  recipientId!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'in_app' })
  channel!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status!: string;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;
}
