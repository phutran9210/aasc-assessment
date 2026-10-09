import type {
  OPERATION_KINDS,
  OPERATION_STATUSES,
  QUEUE_NAMES,
} from '../constants/operation.constants.js';

type UUID = string;

export type OperationKind = (typeof OPERATION_KINDS)[keyof typeof OPERATION_KINDS];
export type OperationStatus = (typeof OPERATION_STATUSES)[keyof typeof OPERATION_STATUSES];
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export type RevisionSet = {
  mapping: number;
  rules: number;
  scoring: number;
};

export type OperationPayload = {
  eventId?: UUID;
  feedbackLedgerId?: UUID;
  leadId?: UUID;
  dealId?: UUID;
  remoteId?: string;
  reportJobId?: UUID;
  notificationId?: UUID;
  sourceOperationId?: UUID;
  timelineId?: UUID;
  reconciliationAttempt?: number;
  errorCode?: string;
  targetVersion?: number;
  revisions?: RevisionSet;
  remoteAbsenceConfirmed?: boolean;
  resolvedTargetLeadId?: UUID;
  idempotencyKeys?: Record<string, { bodyHash: string }>;
};

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
