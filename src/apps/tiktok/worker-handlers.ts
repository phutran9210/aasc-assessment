import type { OperationHandlerRegistry } from '../../core/queue/types/worker.types.js';

export function createTiktokWorkerHandlers(): OperationHandlerRegistry {
  return new Map();
}
