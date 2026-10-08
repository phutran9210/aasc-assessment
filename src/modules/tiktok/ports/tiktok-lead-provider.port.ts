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
  eventKey?: string;
  occurredAt?: string | null;
  campaign?: { id?: string; name?: string };
  ad?: { id?: string; name?: string };
  form?: { id?: string; name?: string };
  utm?: Record<string, unknown>;
  consent?: Record<string, unknown>;
  isHistorical?: boolean;
  applyRules?: boolean;
  sendFeedback?: boolean;
  customQuestions?: Array<{
    question?: string;
    questionId?: string;
    questionText?: string;
    answer: unknown;
  }>;
};

export type TiktokLeadProvider = {
  parseWebhook(raw: Buffer, headers: Record<string, string | undefined>): VerifiedEvent;
  getLeadDetail(id: string): Promise<ProviderLead>;
};

export const TIKTOK_LEAD_PROVIDER = Symbol('TIKTOK_LEAD_PROVIDER');
