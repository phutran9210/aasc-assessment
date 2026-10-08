import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'integration_configuration_head' })
export class ConfigurationHeadEntity {
  @PrimaryColumn({ name: 'config_key', type: 'varchar', length: 100 })
  key!: string;

  @Column({ type: 'integer' })
  revision!: number;
}
