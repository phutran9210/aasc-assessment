export type UUID = string;
export type ExternalId = string;
export type IsoInstant = string;
export type DecimalString = string;

export type TiktokMode = 'mock' | 'business-api';
export type BitrixMode = 'mock' | 'real';

export type Scope = {
  advertiserId: string;
  portalKey: string;
  tiktokMode: TiktokMode;
  bitrixMode: BitrixMode;
};

export type RevisionSet = {
  mapping: number;
  rules: number;
  scoring: number;
};

export type Actor = {
  userId: UUID;
  roles: string[];
  sessionId: string;
};

export const OPERATION_KINDS = {
  tiktokIngest: 'tiktok_ingest',
  bitrixLeadSync: 'bitrix_lead_sync',
  bitrixDealConvert: 'bitrix_deal_convert',
  bitrixDealRefresh: 'bitrix_deal_refresh',
  tiktokFeedback: 'tiktok_feedback',
  integrationReport: 'integration_report',
  integrationNotification: 'integration_notification',
  integrationDlq: 'integration_dlq',
  historicalLeadImport: 'historical_lead_import',
  campaignCostImport: 'campaign_cost_import',
} as const;
export type OperationKind = (typeof OPERATION_KINDS)[keyof typeof OPERATION_KINDS];

export const OPERATION_STATUSES = {
  pending: 'pending',
  processing: 'processing',
  retryWait: 'retry_wait',
  reconcileRequired: 'reconcile_required',
  quarantined: 'quarantined',
  succeeded: 'succeeded',
  deadLetter: 'dead_letter',
  cancelled: 'cancelled',
} as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[keyof typeof OPERATION_STATUSES];

export const QUEUE_NAMES = {
  tiktokIngest: 'tiktok-ingest',
  bitrixLeadSync: 'bitrix-lead-sync',
  bitrixDealConvert: 'bitrix-deal-convert',
  bitrixDealRefresh: 'bitrix-deal-refresh',
  tiktokFeedback: 'tiktok-feedback',
  integrationReport: 'integration-report',
  integrationNotification: 'integration-notification',
  integrationDlq: 'integration-dlq',
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export type OperationPayload = {
  eventId?: UUID;
  leadId?: UUID;
  dealId?: UUID;
  reportJobId?: UUID;
  targetVersion?: number;
  revisions?: RevisionSet;
};
