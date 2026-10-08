export type Page<T> = { items: T[]; total: number; page: number; limit: number };

export type LeadDto = {
  id: string;
  externalId: string;
  source: 'tiktok';
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  campaignId: string | null;
  createdAt: string;
  firstTouchAt: string;
  score: number;
  scoreBreakdown: Record<string, number>;
  businessStatus: string;
  syncStatus: string;
  bitrixLeadId: string | null;
  convertedAt: string | null;
  lastErrorCode: string | null;
};

export type DealDto = {
  id: string;
  leadId: string;
  bitrixDealId: string | null;
  title: string;
  amount: string | null;
  currency: string | null;
  pipelineId: string;
  stageId: string;
  stageSemantics: 'open' | 'won' | 'lost';
  probability: number;
  assignedTo: string | null;
  conversionStatus: string;
  createdAt: string;
  updatedAt: string;
};

export type OperationDto = {
  id: string;
  kind: string;
  aggregateId: string | null;
  targetVersion: number | null;
  status: string;
  attempt: number;
  step: string;
  remoteId: string | null;
  errorCode: string | null;
  nextAttemptAt: string | null;
  configRevisions: Record<string, number>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
