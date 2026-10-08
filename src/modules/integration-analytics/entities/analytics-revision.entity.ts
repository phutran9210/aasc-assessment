import { Column, Entity } from 'typeorm';

import { IntegrationBaseEntity } from '@/apps/tiktok/database/base.entity.js';

@Entity({ name: 'integration_analytics_revision' })
export class AnalyticsRevisionEntity extends IntegrationBaseEntity {
  @Column({ type: 'bigint', default: 0 })
  revision!: string;
}
