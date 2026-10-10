import type { ProviderLead } from '@modules/tiktok/types/index.js';
import type {
  NormalizationResult,
  NormalizationWarning,
  NormalizedLeadInput,
} from '../types/normalized-lead.type.js';
import { normalizeEmail, normalizePhone, normalizeText } from './normalize-contact.js';

type RecordValue = Record<string, unknown>;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function normalizeLead(input: ProviderLead, region: string): NormalizationResult {
  const fields = record(input.fields);
  const leadFields = record(fields.lead_data);
  const campaign = record(fields.campaign);
  const ad = record(fields.ad);
  const form = record(fields.form);
  const nameResult = normalizeText(
    first(leadFields, 'full_name', 'name') ?? first(fields, 'full_name', 'name'),
    255,
  );
  const cityResult = normalizeText(leadFields.city ?? fields.city, 255);
  const emailRaw =
    first(leadFields, 'email', 'email_address') ?? first(fields, 'email', 'email_address');
  const phoneRaw =
    first(leadFields, 'phone', 'phone_number') ?? first(fields, 'phone', 'phone_number');
  const email = normalizeEmail(emailRaw);
  const phone = normalizePhone(phoneRaw, region);
  const warnings: NormalizationWarning[] = [];
  if (emailRaw != null && normalizeText(emailRaw, 254).value && !email)
    warnings.push('EMAIL_INVALID');
  if (phoneRaw != null && normalizeText(phoneRaw, 32).value && !phone)
    warnings.push('PHONE_INVALID');
  if (nameResult.truncated) warnings.push('NAME_TRUNCATED');
  if (cityResult.truncated) warnings.push('CITY_TRUNCATED');

  if (!nameResult.value) return { kind: 'quarantined', reason: 'NAME_MISSING', warnings };
  if (!email && !phone) {
    return { kind: 'quarantined', reason: 'CONTACT_IDENTIFIER_MISSING', warnings };
  }

  const isHistorical = input.isHistorical === true;
  const data: NormalizedLeadInput = {
    providerLeadId: boundedId(input.id),
    advertiserId: boundedId(input.advertiserId) ?? '',
    eventKey: boundedId(input.eventKey ?? input.id) ?? '',
    occurredAt: normalizeInstant(input.occurredAt ?? leadFields.timestamp ?? fields.timestamp),
    name: nameResult.value,
    email,
    phone,
    city: cityResult.value,
    campaignId: normalizedId(
      input.campaign?.id ??
        first(campaign, 'campaign_id', 'id') ??
        first(fields, 'campaign_id', 'campaignId'),
    ),
    campaignName: normalizeText(
      input.campaign?.name ??
        first(campaign, 'campaign_name', 'name') ??
        first(fields, 'campaign_name', 'campaignName'),
      255,
    ).value,
    // The assignment's payload carries the ad inside `campaign`.
    adId: normalizedId(
      input.ad?.id ?? first(ad, 'ad_id', 'id') ?? first(fields, 'ad_id', 'adId') ?? campaign.ad_id,
    ),
    adName: normalizeText(
      input.ad?.name ??
        first(ad, 'ad_name', 'name') ??
        first(fields, 'ad_name', 'adName') ??
        campaign.ad_name,
      255,
    ).value,
    formId: normalizedId(
      input.form?.id ?? first(form, 'form_id', 'id') ?? first(fields, 'form_id', 'formId'),
    ),
    formName: normalizeText(
      input.form?.name ??
        first(form, 'form_name', 'name') ??
        first(fields, 'form_name', 'formName'),
      255,
    ).value,
    ttclid: normalizedId(first(leadFields, 'ttclid') ?? fields.ttclid),
    utm: normalizeUtm(input.utm ?? fields.utm ?? inlineUtm(leadFields)),
    customAnswers: normalizeAnswers(
      input.customQuestions ?? leadFields.custom_questions ?? fields.custom_questions,
    ),
    interests: normalizeInterests(leadFields.interests ?? fields.interests),
    consent: record(input.consent ?? leadFields.consent ?? fields.consent),
    isHistorical,
    applyRules: input.applyRules ?? !isHistorical,
    sendFeedback: input.sendFeedback ?? !isHistorical,
  };
  if (!data.providerLeadId) warnings.push('PROVIDER_LEAD_ID_INVALID');
  if (
    !data.campaignId &&
    (input.campaign?.id ??
      first(campaign, 'campaign_id', 'id') ??
      first(fields, 'campaign_id', 'campaignId')) != null
  ) {
    warnings.push('ATTRIBUTION_ID_INVALID');
  }
  return { kind: 'valid', data, warnings };
}

function first(recordValue: RecordValue, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.hasOwn(recordValue, key) && recordValue[key] !== undefined) return recordValue[key];
  }
  return undefined;
}

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};
}

function boundedId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFC').trim();
  return normalized.length > 0 && Array.from(normalized).length <= 255 ? normalized : null;
}

function normalizedId(value: unknown): string | null {
  return boundedId(value);
}

function normalizeInstant(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeUtm(value: unknown): Record<string, string> {
  const source = record(value);
  const entries = Object.entries(source).flatMap(([key, entry]) => {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,49}$/u.test(key) || UNSAFE_KEYS.has(key.toLowerCase()))
      return [];
    const normalized = normalizeText(entry, 255).value;
    return normalized ? [[key, normalized] as const] : [];
  });
  return Object.fromEntries(entries);
}

/** UTM values sent as `utm_source`, `utm_campaign`, ... next to the contact fields. */
function inlineUtm(leadFields: RecordValue): RecordValue {
  return Object.fromEntries(Object.entries(leadFields).filter(([key]) => key.startsWith('utm_')));
}

function normalizeAnswers(value: unknown): Record<string, unknown> {
  const answers = Object.create(null) as Record<string, unknown>;
  if (!Array.isArray(value)) {
    for (const [key, answer] of Object.entries(record(value)).slice(0, 100)) {
      const normalizedKey = boundedId(key);
      if (normalizedKey && isSafeKey(normalizedKey))
        answers[normalizedKey] = normalizeAnswer(answer, 0);
    }
    return answers;
  }
  for (const item of value.slice(0, 100)) {
    const question = record(item);
    const key =
      boundedId(question.question_id ?? question.questionId) ??
      normalizeText(question.question_text ?? question.question, 2_000).value;
    if (!key || !isSafeKey(key) || !Object.hasOwn(question, 'answer')) continue;
    answers[key] = normalizeAnswer(question.answer, 0);
  }
  return answers;
}

function normalizeAnswer(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return normalizeText(value, 2_000).value ?? '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (depth >= 5) return null;
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => normalizeAnswer(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .flatMap(([key, item]) => {
          const normalizedKey = boundedId(key);
          return normalizedKey && isSafeKey(normalizedKey)
            ? [[normalizedKey, normalizeAnswer(item, depth + 1)] as const]
            : [];
        }),
    );
  }
  return null;
}

function isSafeKey(key: string): boolean {
  return !UNSAFE_KEYS.has(key.toLowerCase());
}

function normalizeInterests(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const interest = normalizeText(item, 255).value;
    if (!interest || seen.has(interest)) continue;
    seen.add(interest);
    output.push(interest);
    if (output.length === 100) break;
  }
  return output;
}
