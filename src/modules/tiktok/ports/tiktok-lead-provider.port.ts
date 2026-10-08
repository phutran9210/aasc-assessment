export type VerifiedEvent = {
  eventKey: string;
  eventType: string;
  advertiserId: string;
  occurredAt: string | null;
  payload: Record<string, unknown>;
};

export type ProviderLead = {
  id: string;
  advertiserId: string;
  fields: Record<string, unknown>;
  customQuestions?: Array<{ question: string; answer: unknown }>;
};

export type TiktokLeadProvider = {
  parseWebhook(raw: Buffer, headers: Record<string, string | undefined>): VerifiedEvent;
  getLeadDetail(id: string): Promise<ProviderLead>;
};

export const TIKTOK_LEAD_PROVIDER = Symbol('TIKTOK_LEAD_PROVIDER');
