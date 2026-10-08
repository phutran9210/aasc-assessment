import { Column, Entity, Index } from 'typeorm';

import { IntegrationBaseEntity } from '@/apps/tiktok/database/base.entity.js';
import { TIKTOK_TABLE_NAMES } from '@/apps/tiktok/database/table-names.js';

@Entity({ name: TIKTOK_TABLE_NAMES.webhookEvent })
@Index('uq_integration_webhook_event_key', ['provider', 'providerMode', 'scopeKey', 'eventKey'], {
  unique: true,
})
@Index('ix_integration_webhook_status_received', ['status', 'receivedAt'])
export class WebhookEventEntity extends IntegrationBaseEntity {
  @Column({ type: 'varchar', length: 32 })
  provider!: 'tiktok' | 'bitrix24';

  @Column({ name: 'provider_mode', type: 'varchar', length: 20 })
  providerMode!: string;

  @Column({ name: 'scope_key', type: 'varchar', length: 255 })
  scopeKey!: string;

  @Column({ name: 'advertiser_id', type: 'varchar', length: 255, nullable: true })
  advertiserId!: string | null;

  @Column({ name: 'portal_key', type: 'varchar', length: 128, nullable: true })
  portalKey!: string | null;

  @Column({ name: 'event_key', type: 'varchar', length: 255 })
  eventKey!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType!: string;

  @Column({ name: 'occurred_at', type: 'timestamptz', nullable: true })
  occurredAt!: Date | null;

  @Column({ name: 'received_at', type: 'timestamptz', default: () => 'now()' })
  receivedAt!: Date;

  @Column({ name: 'raw_body', type: 'bytea' })
  rawBody!: Buffer;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'payload_hash', type: 'varchar', length: 64 })
  payloadHash!: string;

  @Column({ type: 'varchar', length: 24, default: 'received' })
  status!: string;

  @Column({ name: 'error_code', type: 'varchar', length: 100, nullable: true })
  errorCode!: string | null;
}
