import { Column, Entity, Index } from 'typeorm';

import { IntegrationBaseEntity } from '@/apps/tiktok/database/base.entity.js';

@Entity({ name: 'integration_report_job' })
@Index('ix_integration_report_job_owner_created', ['requesterId', 'createdAt'])
@Index('ix_integration_report_job_status_created', ['status', 'createdAt'])
export class ReportJobEntity extends IntegrationBaseEntity {
  @Column({ type: 'varchar', length: 32 })
  kind!: 'export' | 'import' | 'scheduled';

  @Column({ name: 'requester_id', type: 'uuid', nullable: true })
  requesterId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  filters!: Record<string, unknown>;

  @Column({ name: 'snapshot_at', type: 'timestamptz', nullable: true })
  snapshotAt!: Date | null;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cursor!: string | null;

  @Column({ name: 'total_rows', type: 'integer', default: 0 })
  totalRows!: number;

  @Column({ name: 'success_rows', type: 'integer', default: 0 })
  successRows!: number;

  @Column({ name: 'failed_rows', type: 'integer', default: 0 })
  failedRows!: number;

  @Column({ name: 'artifact_path', type: 'text', nullable: true, select: false })
  artifactPath!: string | null;

  @Column({ name: 'artifact_hash', type: 'varchar', length: 64, nullable: true })
  artifactHash!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ name: 'error_summary', type: 'text', nullable: true })
  errorSummary!: string | null;
}
