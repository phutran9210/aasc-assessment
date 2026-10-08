import { Column, Entity, Index } from 'typeorm';

import { IntegrationBaseEntity } from '../../../apps/tiktok/database/base.entity.js';
import { TIKTOK_TABLE_NAMES } from '../../../apps/tiktok/database/table-names.js';

@Entity({ name: TIKTOK_TABLE_NAMES.integrationUser })
@Index('uq_integration_user_username', ['username'], { unique: true })
export class IntegrationUserEntity extends IntegrationBaseEntity {
  @Column({ type: 'varchar', length: 80 })
  username!: string;

  @Column({ name: 'password_hash', type: 'text', select: false })
  passwordHash!: string;

  @Column({ type: 'text', array: true, default: () => "ARRAY['integration_analyst']::text[]" })
  roles!: string[];

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'auth_version', type: 'integer', default: 1 })
  authVersion!: number;
}
