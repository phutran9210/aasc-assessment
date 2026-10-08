export const OPERATION_KINDS = {
  tiktokIngest: 'tiktok_ingest',
  bitrixLeadSync: 'bitrix_lead_sync',
  bitrixDealConvert: 'bitrix_deal_convert',
  bitrixDealRefresh: 'bitrix_deal_refresh',
  tiktokFeedback: 'tiktok_feedback',
  crmTimeline: 'crm_timeline',
  integrationReport: 'integration_report',
  integrationNotification: 'integration_notification',
  integrationDlq: 'integration_dlq',
  historicalLeadImport: 'historical_lead_import',
  campaignCostImport: 'campaign_cost_import',
} as const;

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

export const OPERATION_QUEUE = {
  [OPERATION_KINDS.tiktokIngest]: QUEUE_NAMES.tiktokIngest,
  [OPERATION_KINDS.bitrixLeadSync]: QUEUE_NAMES.bitrixLeadSync,
  [OPERATION_KINDS.bitrixDealConvert]: QUEUE_NAMES.bitrixDealConvert,
  [OPERATION_KINDS.bitrixDealRefresh]: QUEUE_NAMES.bitrixDealRefresh,
  [OPERATION_KINDS.tiktokFeedback]: QUEUE_NAMES.tiktokFeedback,
  [OPERATION_KINDS.crmTimeline]: QUEUE_NAMES.bitrixLeadSync,
  [OPERATION_KINDS.integrationReport]: QUEUE_NAMES.integrationReport,
  [OPERATION_KINDS.integrationNotification]: QUEUE_NAMES.integrationNotification,
  [OPERATION_KINDS.integrationDlq]: QUEUE_NAMES.integrationDlq,
  [OPERATION_KINDS.historicalLeadImport]: QUEUE_NAMES.tiktokIngest,
  [OPERATION_KINDS.campaignCostImport]: QUEUE_NAMES.integrationReport,
} as const;

export const RETRYABLE_OPERATION_KINDS = [
  OPERATION_KINDS.tiktokIngest,
  OPERATION_KINDS.bitrixLeadSync,
  OPERATION_KINDS.bitrixDealConvert,
  OPERATION_KINDS.bitrixDealRefresh,
  OPERATION_KINDS.tiktokFeedback,
  OPERATION_KINDS.crmTimeline,
] as const;

export function retryQueueForOperation(
  kind: string,
): (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES] | undefined {
  if (!(RETRYABLE_OPERATION_KINDS as readonly string[]).includes(kind)) return undefined;
  return OPERATION_QUEUE[kind as (typeof RETRYABLE_OPERATION_KINDS)[number]];
}
