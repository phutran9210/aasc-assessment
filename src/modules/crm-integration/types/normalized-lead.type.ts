export type NormalizedLeadInput = {
  providerLeadId: string | null;
  advertiserId: string;
  eventKey: string;
  occurredAt: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  campaignId: string | null;
  campaignName: string | null;
  adId: string | null;
  adName: string | null;
  formId: string | null;
  formName: string | null;
  ttclid: string | null;
  utm: Record<string, string>;
  customAnswers: Record<string, unknown>;
  interests: string[];
  consent: Record<string, unknown>;
  isHistorical: boolean;
  applyRules: boolean;
  sendFeedback: boolean;
};

export type NormalizationWarning =
  | 'EMAIL_INVALID'
  | 'PHONE_INVALID'
  | 'NAME_TRUNCATED'
  | 'CITY_TRUNCATED'
  | 'PROVIDER_LEAD_ID_INVALID'
  | 'ATTRIBUTION_ID_INVALID';

export type NormalizationResult =
  | { kind: 'valid'; data: NormalizedLeadInput; warnings: NormalizationWarning[] }
  | {
      kind: 'quarantined';
      reason: 'CONTACT_IDENTIFIER_MISSING' | 'NAME_MISSING';
      warnings: NormalizationWarning[];
    };

export type CrmFieldSet = Record<string, unknown>;
