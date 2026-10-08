import { Column, Entity, Index } from 'typeorm';

import { IntegrationBaseEntity } from '../../../apps/tiktok/database/base.entity.js';
import { TIKTOK_TABLE_NAMES } from '../../../apps/tiktok/database/table-names.js';

@Entity({ name: TIKTOK_TABLE_NAMES.leadIdentity })
@Index('uq_integration_lead_identity_value', ['advertiserId', 'identityType', 'normalizedValue'], {
  unique: true,
})
@Index('ix_integration_lead_identity_lead', ['leadId'])
export class LeadIdentityEntity extends IntegrationBaseEntity {
  @Column({ name: 'advertiser_id', type: 'varchar', length: 255 })
  advertiserId!: string;

  @Column({ name: 'identity_type', type: 'varchar', length: 16 })
  identityType!: 'email' | 'phone';

  @Column({ name: 'normalized_value', type: 'varchar', length: 254 })
  normalizedValue!: string;

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId!: string;
}
