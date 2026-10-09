import type { OperationHandler, OperationHandlerRegistry } from '@core/queue/types/worker.types.js';
import { OPERATION_KINDS } from '@core/queue/constants/operation.constants.js';
import type { TiktokIngestHandler } from '@modules/crm-integration/workers/tiktok-ingest.handler.js';
import type { LeadSyncHandler } from '@modules/crm-integration/workers/lead-sync.handler.js';
import type { TimelineHandler } from '@modules/crm-integration/workers/timeline.handler.js';
import type { ConversionHandler } from '@modules/crm-integration/workers/conversion.handler.js';
import type { DealRefreshHandler } from '@modules/crm-integration/workers/deal-refresh.handler.js';
import type { FeedbackHandler } from '@modules/tiktok/workers/feedback.handler.js';
import type { ExportHandler } from '@modules/integration-reports/workers/export.handler.js';

export const TIKTOK_WORKER_OPERATION_KINDS = [
  OPERATION_KINDS.tiktokIngest,
  OPERATION_KINDS.bitrixLeadSync,
  OPERATION_KINDS.crmTimeline,
  OPERATION_KINDS.bitrixDealConvert,
  OPERATION_KINDS.bitrixDealRefresh,
  OPERATION_KINDS.tiktokFeedback,
  OPERATION_KINDS.integrationReport,
] as const;

export function createTiktokWorkerHandlers(
  ingest: TiktokIngestHandler,
  leadSync: LeadSyncHandler,
  timeline: TimelineHandler,
  conversion: ConversionHandler,
  dealRefresh: DealRefreshHandler,
  feedback: FeedbackHandler,
  report: ExportHandler,
): OperationHandlerRegistry {
  return new Map<string, OperationHandler>([
    ['tiktok_ingest', ingest],
    ['bitrix_lead_sync', leadSync],
    ['crm_timeline', timeline],
    ['bitrix_deal_convert', conversion],
    ['bitrix_deal_refresh', dealRefresh],
    ['tiktok_feedback', feedback],
    ['integration_report', report],
  ]);
}
