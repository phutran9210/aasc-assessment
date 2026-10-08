import type {
  OperationHandler,
  OperationHandlerRegistry,
} from '../../core/queue/types/worker.types.js';
import type { TiktokIngestHandler } from '../../modules/crm-integration/workers/tiktok-ingest.handler.js';
import type { LeadSyncHandler } from '../../modules/crm-integration/workers/lead-sync.handler.js';
import type { TimelineHandler } from '../../modules/crm-integration/workers/timeline.handler.js';

export function createTiktokWorkerHandlers(
  ingest: TiktokIngestHandler,
  leadSync: LeadSyncHandler,
  timeline: TimelineHandler,
): OperationHandlerRegistry {
  return new Map<string, OperationHandler>([
    ['tiktok_ingest', ingest],
    ['bitrix_lead_sync', leadSync],
    ['crm_timeline', timeline],
  ]);
}
