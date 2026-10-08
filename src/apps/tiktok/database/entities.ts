import { ConfigurationHeadEntity } from '@modules/crm-integration/entities/configuration-head.entity.js';
import { BitrixInstallationEntity } from '@modules/crm-integration/entities/bitrix-installation.entity.js';
import { ConfigurationEntity } from '@modules/crm-integration/entities/configuration.entity.js';
import { AssignmentCursorEntity } from '@modules/crm-integration/entities/assignment-cursor.entity.js';
import { AuditEventEntity } from '@modules/crm-integration/entities/audit-event.entity.js';
import { DealEntity } from '@modules/crm-integration/entities/deal.entity.js';
import { DealHistoryEntity } from '@modules/crm-integration/entities/deal-history.entity.js';
import { DealPollCheckpointEntity } from '@modules/crm-integration/entities/deal-poll-checkpoint.entity.js';
import { FeedbackLedgerEntity } from '@modules/crm-integration/entities/feedback-ledger.entity.js';
import { LeadIdentityEntity } from '@modules/crm-integration/entities/lead-identity.entity.js';
import { LeadEntity } from '@modules/crm-integration/entities/lead.entity.js';
import { SubmissionEntity } from '@modules/crm-integration/entities/submission.entity.js';
import { IntegrationUserEntity } from '@modules/integration-auth/entities/integration-user.entity.js';
import { AggregateLeaseEntity } from '@core/queue/entities/aggregate-lease.entity.js';
import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { OutboxEntity } from '@core/queue/entities/outbox.entity.js';
import { WebhookEventEntity } from '@core/queue/entities/webhook-event.entity.js';
import { CampaignDailyEntity } from '@modules/integration-analytics/entities/campaign-daily.entity.js';
import { NotificationEntity } from '@modules/integration-reports/entities/notification.entity.js';
import { ReportJobEntity } from '@modules/integration-reports/entities/report-job.entity.js';
import { ReportRowErrorEntity } from '@modules/integration-reports/entities/report-row-error.entity.js';
import { AnalyticsRevisionEntity } from '@modules/integration-analytics/entities/analytics-revision.entity.js';
import { TimelineEntity } from '@modules/crm-integration/entities/timeline.entity.js';

export const TIKTOK_ENTITIES = [
  IntegrationUserEntity,
  BitrixInstallationEntity,
  ConfigurationEntity,
  ConfigurationHeadEntity,
  LeadEntity,
  LeadIdentityEntity,
  SubmissionEntity,
  DealEntity,
  DealHistoryEntity,
  DealPollCheckpointEntity,
  FeedbackLedgerEntity,
  AssignmentCursorEntity,
  AuditEventEntity,
  WebhookEventEntity,
  OperationEntity,
  OutboxEntity,
  AggregateLeaseEntity,
  CampaignDailyEntity,
  ReportJobEntity,
  ReportRowErrorEntity,
  NotificationEntity,
  AnalyticsRevisionEntity,
  TimelineEntity,
] as const;
