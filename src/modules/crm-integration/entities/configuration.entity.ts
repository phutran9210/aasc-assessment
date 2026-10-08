import { Column, Entity, Index } from 'typeorm';

import { IntegrationBaseEntity } from '../../../apps/tiktok/database/base.entity.js';
import { TIKTOK_TABLE_NAMES } from '../../../apps/tiktok/database/table-names.js';

@Entity({ name: TIKTOK_TABLE_NAMES.configuration })
@Index('uq_integration_configuration_key_revision', ['key', 'revision'], { unique: true })
export class ConfigurationEntity extends IntegrationBaseEntity {
  @Column({ name: 'config_key', type: 'varchar', length: 100 })
  key!: string;

  @Column({ type: 'integer' })
  revision!: number;

  @Column({ type: 'jsonb' })
  value!: Record<string, unknown>;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;
}
