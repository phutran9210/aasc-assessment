import { Column, Entity, Index } from 'typeorm';

import { IntegrationBaseEntity } from '@/apps/tiktok/database/base.entity.js';

@Entity({ name: 'integration_report_row_error' })
@Index('uq_integration_report_row_error', ['reportJobId', 'rowNumber'], { unique: true })
export class ReportRowErrorEntity extends IntegrationBaseEntity {
  @Column({ name: 'report_job_id', type: 'uuid' })
  reportJobId!: string;

  @Column({ name: 'row_number', type: 'integer' })
  rowNumber!: number;

  @Column({ name: 'source_key', type: 'varchar', length: 255, nullable: true })
  sourceKey!: string | null;

  @Column({ name: 'error_code', type: 'varchar', length: 100 })
  errorCode!: string;

  @Column({ name: 'redacted_detail', type: 'text', nullable: true })
  redactedDetail!: string | null;
}
