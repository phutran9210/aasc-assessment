import { BaseEntity } from '@core/database/entities/base.entity.js';
import { TABLE_NAMES } from '@core/database/table-names.js';

import { Column, Entity, Index } from 'typeorm';

@Entity(TABLE_NAMES.BITRIX_INSTALLATION)
@Index('uq_bitrix_installation_member_id', ['memberId'], { unique: true })
export class BitrixInstallation extends BaseEntity {
  @Column({ type: 'varchar', length: 100 })
  memberId: string;

  @Column({ type: 'varchar', length: 255 })
  domain: string;

  @Column({ type: 'varchar', length: 500 })
  clientEndpoint: string;

  @Column({ type: 'varchar', length: 500 })
  serverEndpoint: string;

  @Column({ type: 'varchar', length: 500 })
  scope: string;

  @Column({ type: 'varchar', length: 20 })
  status: string;

  @Column({ type: 'varchar', length: 500 })
  accessToken: string;

  @Column({ type: 'varchar', length: 500 })
  refreshToken: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  applicationToken: string | null;

  @Column({ type: 'datetime' })
  accessTokenExpiresAt: Date;

  /** Epoch milliseconds until which one process holds the right to refresh; null when free. */
  @Column({ type: 'integer', nullable: true })
  refreshLockedUntil: number | null;
}
