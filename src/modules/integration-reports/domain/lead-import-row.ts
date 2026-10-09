import { createHash } from 'node:crypto';

export type LeadImportRow =
  | {
      ok: true;
      sourceRecordId: string;
      eventKey: string;
      occurredAt: Date;
      payload: Record<string, unknown>;
      payloadHash: string;
    }
  | { ok: false; errorCode: LeadImportRowError; sourceKey: string | null; field: string };

export type LeadImportRowError =
  | 'SOURCE_RECORD_ID_MISSING'
  | 'SOURCE_RECORD_ID_INVALID'
  | 'ADVERTISER_MISMATCH'
  | 'OCCURRED_AT_INVALID';

const SOURCE_ID_MAX_LENGTH = 200;
// An explicit offset is required: a local time without one cannot be placed on the timeline.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Turns one validated import row into the same event payload shape the webhook path stores, so
 * both go through one normalization and deduplication entry. The stable source record id is the
 * event key; a row number is never used as an identity.
 */
export function buildLeadImportRow(
  values: Record<string, string>,
  advertiserId: string,
  now: Date,
): LeadImportRow {
  const text = (key: string) => (values[key] ?? '').trim();
  const sourceRecordId = text('source_record_id');
  if (!sourceRecordId) {
    return fail('SOURCE_RECORD_ID_MISSING', null, 'source_record_id');
  }
  if (Array.from(sourceRecordId).length > SOURCE_ID_MAX_LENGTH) {
    return fail('SOURCE_RECORD_ID_INVALID', null, 'source_record_id');
  }
  if (text('advertiser_id') !== advertiserId) {
    return fail('ADVERTISER_MISMATCH', sourceRecordId, 'advertiser_id');
  }
  const occurredAt = INSTANT.test(text('occurred_at')) ? new Date(text('occurred_at')) : null;
  if (!occurredAt || Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > now.getTime()) {
    return fail('OCCURRED_AT_INVALID', sourceRecordId, 'occurred_at');
  }

  const optional = (key: string) => text(key) || undefined;
  const consent = text('crm_feedback_allowed').toLowerCase();
  const payload = prune({
    provider_lead_id: `import:${sourceRecordId}`,
    source: 'historical_import',
    timestamp: occurredAt.toISOString(),
    lead_data: prune({
      full_name: optional('full_name'),
      email: optional('email'),
      phone: optional('phone'),
      city: optional('city'),
      ttclid: optional('ttclid'),
      interests: text('interests')
        ? text('interests')
            .split(';')
            .map((interest) => interest.trim())
            .filter(Boolean)
        : undefined,
    }),
    campaign: prune({
      campaign_id: optional('campaign_id'),
      campaign_name: optional('campaign_name'),
    }),
    ad: prune({ ad_id: optional('ad_id'), ad_name: optional('ad_name') }),
    form: prune({ form_id: optional('form_id'), form_name: optional('form_name') }),
    consent:
      consent === 'true' || consent === 'false'
        ? { crm_feedback_allowed: consent === 'true' }
        : undefined,
  });
  return {
    ok: true,
    sourceRecordId,
    eventKey: `import:${sourceRecordId}`,
    occurredAt,
    payload,
    payloadHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
  };
}

function fail(errorCode: LeadImportRowError, sourceKey: string | null, field: string) {
  return { ok: false, errorCode, sourceKey, field } as const;
}

function prune<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, entry]) =>
        entry !== undefined &&
        !(
          entry &&
          typeof entry === 'object' &&
          !Array.isArray(entry) &&
          !Object.keys(entry).length
        ),
    ),
  );
}
