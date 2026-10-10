import type { AggregateLease } from './operation.types.js';
import type { OperationEntity } from '../entities/operation.entity.js';

export type OperationOutcome =
  | { outcome: 'succeeded'; remoteId?: string | null }
  | {
      outcome: 'retry_wait';
      nextAttemptAt: Date;
      errorCode: string;
      // Waiting for something that is not a failure, such as a busy aggregate lease. A deferred
      // retry does not spend the attempt budget.
      deferred?: true;
    }
  | { outcome: 'reconcile_required'; errorCode: string }
  | { outcome: 'quarantined'; errorCode: string }
  | { outcome: 'dead_letter'; errorCode: string };

export type OperationContext = {
  operationId: string;
  ownerToken: string;
  attempt: number;
  revisions: OperationEntity['configRevisions'];
  signal: AbortSignal;
  assertOwnership(): Promise<void>;
  acquireAggregateLease(key: string): Promise<AggregateLease | null>;
  releaseAggregateLease(lease: AggregateLease): Promise<boolean>;
};

export type OperationHandler = {
  handle(context: OperationContext): Promise<OperationOutcome>;
};

export type OperationHandlerRegistry = ReadonlyMap<string, OperationHandler>;
