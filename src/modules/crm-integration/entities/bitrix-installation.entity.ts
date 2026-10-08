import { Column, Entity, Index } from 'typeorm';

import { IntegrationBaseEntity } from '../../../apps/tiktok/database/base.entity.js';
import { TIKTOK_TABLE_NAMES } from '../../../apps/tiktok/database/table-names.js';

@Entity({ name: TIKTOK_TABLE_NAMES.bitrixInstallation })
@Index('uq_integration_bitrix_portal_key', ['portalKey'], { unique: true })
@Index('uq_integration_bitrix_member_id', ['memberId'], { unique: true })
export class BitrixInstallationEntity extends IntegrationBaseEntity {
  @Column({ name: 'portal_key', type: 'varchar', length: 128 })
  portalKey!: string;

  @Column({ name: 'member_id', type: 'varchar', length: 128, nullable: true })
  memberId!: string | null;

  @Column({ name: 'domain', type: 'varchar', length: 253 })
  domain!: string;

  @Column({ name: 'client_endpoint', type: 'text', nullable: true })
  clientEndpoint!: string | null;

  @Column({ name: 'server_endpoint', type: 'text', nullable: true })
  serverEndpoint!: string | null;

  @Column({ name: 'scope', type: 'text', nullable: true })
  scope!: string | null;

  @Column({ name: 'status', type: 'varchar', length: 32, nullable: true })
  status!: string | null;

  @Column({ name: 'application_token', type: 'text', select: false, nullable: true })
  applicationToken!: string | null;

  @Column({ name: 'access_token', type: 'text', select: false, nullable: true })
  accessToken!: string | null;

  @Column({ name: 'refresh_token', type: 'text', select: false, nullable: true })
  refreshToken!: string | null;

  @Column({ name: 'access_token_expires_at', type: 'timestamptz', nullable: true })
  accessTokenExpiresAt!: Date | null;

  @Column({ name: 'refresh_lease_until', type: 'timestamptz', nullable: true })
  refreshLeaseUntil!: Date | null;

  @Column({ name: 'refresh_lease_token', type: 'uuid', nullable: true, select: false })
  refreshLeaseToken!: string | null;
}
