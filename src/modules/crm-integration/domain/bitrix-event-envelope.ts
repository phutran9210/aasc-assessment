import { parse as parseQueryString } from 'node:querystring';

export type BitrixDealEvent = {
  eventType: 'deal.add' | 'deal.update' | 'deal.delete';
  remoteId: string;
  timestamp: Date;
  eventKey: string;
  domain?: string;
  memberId?: string;
  applicationToken?: string;
  mockPortalKey?: string;
};

const EVENT_TYPES: Record<string, BitrixDealEvent['eventType']> = {
  ONCRMDEALADD: 'deal.add',
  ONCRMDEALUPDATE: 'deal.update',
  ONCRMDEALDELETE: 'deal.delete',
};
const MOCK_EVENT_TYPES: Record<string, BitrixDealEvent['eventType']> = {
  'deal.add': 'deal.add',
  'deal.update': 'deal.update',
  'deal.delete': 'deal.delete',
};

/** Parse verified Bitrix x-www-form-urlencoded envelopes or the local mock contract. */
export function parseBitrixDealEvent(raw: unknown): BitrixDealEvent {
  const envelope = toRecord(typeof raw === 'string' || Buffer.isBuffer(raw) ? parseBody(raw) : raw);
  const event = text(envelope.event);
  const mock = Object.hasOwn(MOCK_EVENT_TYPES, event ?? '');
  const data = toRecord(envelope.data);
  const fields = toRecord(data.FIELDS ?? data.fields);
  const auth = toRecord(envelope.auth);
  const remoteId = text(mock ? envelope.deal_id : (fields.ID ?? fields.id));
  const rawTimestamp = mock ? envelope.timestamp : envelope.ts;
  const timestamp = parseTimestamp(rawTimestamp, mock);
  const eventType = mock ? MOCK_EVENT_TYPES[event ?? ''] : EVENT_TYPES[event ?? ''];

  if (!eventType || !remoteId || !/^[1-9]\d*$/.test(remoteId) || !timestamp)
    throw new Error('Invalid Bitrix deal event');
  if (!mock && (!text(auth.domain) || !text(auth.member_id) || !text(auth.application_token))) {
    throw new Error('Invalid Bitrix deal event');
  }

  const eventKey = mock ? text(envelope.event_id) : `${event}:${remoteId}:${text(envelope.ts)}`;
  const mockPortalKey = mock ? text(envelope.portal_key) : undefined;
  if (!eventKey || (mock && !mockPortalKey)) throw new Error('Invalid Bitrix deal event');

  return {
    eventType,
    remoteId,
    timestamp,
    eventKey,
    ...(mock
      ? { mockPortalKey }
      : {
          domain: text(auth.domain),
          memberId: text(auth.member_id),
          applicationToken: text(auth.application_token),
        }),
  };
}

function parseBody(raw: string | Buffer): unknown {
  const value = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
  if (value.trimStart().startsWith('{')) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new Error('Invalid Bitrix deal event');
    }
  }
  return parseForm(value);
}

function parseForm(raw: string | Buffer): Record<string, unknown> {
  const parsed = parseQueryString(Buffer.isBuffer(raw) ? raw.toString('utf8') : raw);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    setPath(result, key, Array.isArray(value) ? value[0] : value);
  }
  return result;
}

function setPath(target: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.replaceAll('[', '.').replaceAll(']', '').split('.').filter(Boolean);
  if (!parts.length) return;
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    if (!child || typeof child !== 'object' || Array.isArray(child)) current[part] = {};
    const next = current[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) return;
    current = next as Record<string, unknown>;
  }
  const last = parts.at(-1);
  if (last) current[last] = value;
}

function parseTimestamp(value: unknown, iso: boolean): Date | null {
  const textValue = text(value);
  if (!textValue) return null;
  const date = iso ? new Date(textValue) : new Date(Number(textValue) * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const result = String(value).trim();
  return result || undefined;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
