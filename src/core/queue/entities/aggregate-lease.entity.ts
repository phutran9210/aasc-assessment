import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'integration_aggregate_lease' })
export class AggregateLeaseEntity {
  @PrimaryColumn({ name: 'lease_key', type: 'varchar', length: 512 })
  key!: string;

  @Column({ name: 'owner_token', type: 'uuid' })
  ownerToken!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
