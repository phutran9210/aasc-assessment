import type {
  OperationKind,
  OperationPayload,
  QueueName,
  RevisionSet,
} from '../../../modules/crm-integration/types/integration.types.js';

export type WebhookEventInput = {
  provider: 'tiktok' | 'bitrix24';
  providerMode: string;
  scopeKey: string;
  advertiserId?: string | null;
  portalKey?: string | null;
  eventKey: string;
  eventType: string;
  occurredAt?: Date | null;
  rawBody: Buffer;
  payload: Record<string, unknown>;
  payloadHash: string;
};

export type EnsureOperationInput = {
  operationKey: string;
  kind: OperationKind;
  aggregateId?: string | null;
  targetVersion?: number | null;
  payload?: OperationPayload;
  configRevisions?: Partial<RevisionSet>;
  actorId?: string | null;
};

export type QueueDispatchInput = {
  operationId: string;
  queue: QueueName;
  availableAt?: Date;
};

export type AggregateLease = {
  key: string;
  ownerToken: string;
  expiresAt: Date;
};
