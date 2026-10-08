import type { OperationHandlerRegistry } from '../../core/queue/types/worker.types.js';
import type { TiktokIngestHandler } from '../../modules/crm-integration/workers/tiktok-ingest.handler.js';

export function createTiktokWorkerHandlers(ingest: TiktokIngestHandler): OperationHandlerRegistry {
  return new Map([['tiktok_ingest', ingest]]);
}
