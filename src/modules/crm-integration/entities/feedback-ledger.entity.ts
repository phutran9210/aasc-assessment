import { Column, Entity, Index } from 'typeorm';

import { IntegrationBaseEntity } from '../../../apps/tiktok/database/base.entity.js';
import { TIKTOK_TABLE_NAMES } from '../../../apps/tiktok/database/table-names.js';
import type { FeedbackMilestone } from '../../tiktok/domain/feedback-payload.js';

@Entity({ name: TIKTOK_TABLE_NAMES.feedbackLedger })
@Index('uq_integration_feedback_milestone', ['advertiserId', 'leadId', 'milestone'], {
  unique: true,
})
@Index('uq_integration_feedback_event_id', ['eventId'], { unique: true })
export class FeedbackLedgerEntity extends IntegrationBaseEntity {
  @Column({ name: 'advertiser_id', type: 'varchar', length: 255 })
  advertiserId!: string;

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId!: string;

  @Column({ type: 'varchar', length: 32 })
  milestone!: FeedbackMilestone;

  @Column({ name: 'event_id', type: 'varchar', length: 64 })
  eventId!: string;

  @Column({ type: 'varchar', length: 24 })
  status!: 'queued' | 'accepted' | 'rejected' | 'skipped_no_consent' | 'disabled';

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  detail!: Record<string, unknown>;

  @Column({ name: 'last_error_code', type: 'varchar', length: 100, nullable: true })
  lastErrorCode!: string | null;

  @Column({ name: 'operation_id', type: 'uuid', nullable: true })
  operationId!: string | null;
}
