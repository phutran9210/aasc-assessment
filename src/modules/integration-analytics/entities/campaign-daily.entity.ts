import { Column, Entity, Index } from 'typeorm';

import { IntegrationBaseEntity } from '../../../apps/tiktok/database/base.entity.js';

@Entity({ name: 'integration_campaign_daily' })
@Index(
  'uq_integration_campaign_daily_natural_key',
  ['advertiserId', 'campaignId', 'reportDate', 'currency'],
  {
    unique: true,
  },
)
@Index('ix_integration_campaign_daily_campaign_date', ['campaignId', 'reportDate'])
export class CampaignDailyEntity extends IntegrationBaseEntity {
  @Column({ name: 'advertiser_id', type: 'varchar', length: 255 })
  advertiserId!: string;

  @Column({ name: 'campaign_id', type: 'varchar', length: 255 })
  campaignId!: string;

  @Column({ name: 'report_date', type: 'date' })
  reportDate!: string;

  @Column({ name: 'reporting_timezone', type: 'varchar', length: 80 })
  reportingTimezone!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'numeric', precision: 20, scale: 4 })
  spend!: string;

  @Column({ type: 'bigint', nullable: true })
  impressions!: string | null;

  @Column({ type: 'bigint', nullable: true })
  clicks!: string | null;

  @Column({ type: 'varchar', length: 16 })
  source!: 'mock' | 'import' | 'api';

  @Column({ name: 'fetched_at', type: 'timestamptz' })
  fetchedAt!: Date;
}
