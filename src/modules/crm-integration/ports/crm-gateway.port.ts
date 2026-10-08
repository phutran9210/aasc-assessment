import type { ExternalId } from '../types/integration.types.js';

export const CRM_GATEWAY = Symbol('CRM_GATEWAY');

export type CrmFieldMetadata = {
  name: string;
  title: string;
  type: string;
  required: boolean;
  readOnly: boolean;
  multiple: boolean;
  maxLength?: number;
};

export type CrmStage = { id: string; name: string; categoryId: number; semantic: string | null };
export type CrmUser = { id: ExternalId; name: string; active: boolean };
export type CrmMetadata = {
  lead: { entityTypeId: 1; fields: Record<string, CrmFieldMetadata> };
  deal: { entityTypeId: 2; fields: Record<string, CrmFieldMetadata> };
  stages: CrmStage[];
  users: CrmUser[];
};

export type CrmCandidateQuery = {
  marker?: ExternalId;
  email?: string;
  phone?: string;
  limit?: number;
  offset?: number;
};

export type RemoteLead = {
  id: ExternalId;
  title: string;
  marker: ExternalId | null;
  fields: Record<string, unknown>;
  stale?: boolean;
};

export type RemoteDeal = {
  id: ExternalId;
  title: string;
  marker: ExternalId | null;
  fields: Record<string, unknown>;
};

export type TimelineInput = {
  entityType: 'lead' | 'deal';
  entityId: ExternalId;
  marker: ExternalId;
  comment: string;
};

export type TimelineEntry = TimelineInput & { id: ExternalId };

export type CrmGateway = {
  metadata(): Promise<CrmMetadata>;
  findLeadCandidates(query: CrmCandidateQuery): Promise<RemoteLead[]>;
  getLead(id: ExternalId): Promise<RemoteLead>;
  createLead(fields: Record<string, unknown>, marker: ExternalId): Promise<RemoteLead>;
  updateLead(id: ExternalId, patch: Record<string, unknown>): Promise<RemoteLead>;
  findDeals(query: CrmCandidateQuery): Promise<RemoteDeal[]>;
  getDeal(id: ExternalId): Promise<RemoteDeal>;
  createDeal(fields: Record<string, unknown>, marker: ExternalId): Promise<RemoteDeal>;
  completeLead(id: ExternalId, stage: string): Promise<RemoteLead>;
  findTimeline(marker: ExternalId): Promise<TimelineEntry[]>;
  addTimeline(input: TimelineInput): Promise<TimelineEntry>;
};
