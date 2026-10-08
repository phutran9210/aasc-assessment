import { BaseEntity } from '@core/database/entities/base.entity.js';
import { TABLE_NAMES } from '@core/database/table-names.js';

import { Column, Entity, Index } from 'typeorm';

/**
 * A lead Bitrix24 reported as changed and that has not been pulled into the Sheet yet. Kept in
 * the database so that an event received just before a restart is not lost.
 */
@Entity(TABLE_NAMES.LEAD_SYNC_PENDING_LEAD)
@Index('ux_lead_sync_pending_lead_lead_id', ['leadId'], { unique: true })
export class LeadSyncPendingLead extends BaseEntity {
  @Column({ type: 'integer' })
  leadId: number;
}
