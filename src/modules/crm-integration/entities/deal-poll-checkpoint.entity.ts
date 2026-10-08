import { Column, Entity, Index } from 'typeorm';

import { IntegrationBaseEntity } from '../../../apps/tiktok/database/base.entity.js';
import { TIKTOK_TABLE_NAMES } from '../../../apps/tiktok/database/table-names.js';

@Entity({ name: TIKTOK_TABLE_NAMES.dealPollCheckpoint })
@Index('uq_integration_deal_poll_portal', ['portalKey'], { unique: true })
export class DealPollCheckpointEntity extends IntegrationBaseEntity {
  @Column({ name: 'portal_key', type: 'varchar', length: 128 })
  portalKey!: string;

  @Column({ name: 'incremental_watermark', type: 'timestamptz', nullable: true })
  incrementalWatermark!: Date | null;

  @Column({ name: 'full_scan_at', type: 'timestamptz', nullable: true })
  fullScanAt!: Date | null;

  @Column({ name: 'active_mode', type: 'varchar', length: 16, nullable: true })
  activeMode!: 'incremental' | 'full' | null;

  @Column({ name: 'page_offset', type: 'integer', default: 0 })
  pageOffset!: number;
}
