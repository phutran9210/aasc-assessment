import { Logger } from '@nestjs/common';

import { IntegrationLogger, IntegrationMetrics } from '../integration-logger.js';
import { REDACTED, redact, redactText } from '../redact.js';

describe('redact', () => {
  it('replaces secret-bearing keys at any depth without mutating the input', () => {
    const input = {
      user: 'operator',
      password: 'hunter2',
      nested: {
        access_token: 'at-123',
        refreshToken: 'rt-456',
        client_secret: 'cs-789',
        list: [
          { Authorization: 'Bearer abc.def.ghi' },
          { 'x-tiktok-signature': 't=1,v1=deadbeef' },
        ],
      },
      apiKey: 'k',
      cookie: 'sid=1',
      rawBody: Buffer.from('{"email":"a@b.co"}'),
    };

    expect(redact(input)).toEqual({
      user: 'operator',
      password: REDACTED,
      nested: {
        access_token: REDACTED,
        refreshToken: REDACTED,
        client_secret: REDACTED,
        list: [{ Authorization: REDACTED }, { 'x-tiktok-signature': REDACTED }],
      },
      apiKey: REDACTED,
      cookie: REDACTED,
      rawBody: REDACTED,
    });
    expect(input.password).toBe('hunter2');
  });

  it('masks contact data wherever it appears', () => {
    expect(
      redact({
        email: 'person.name@example.com',
        phone: '+84901234567',
        note: 'call +84901234567 or write person.name@example.com today',
      }),
    ).toEqual({
      email: 'p***@example.com',
      phone: '+84*******67',
      note: 'call +84*******67 or write p***@example.com today',
    });
  });

  it('strips credentials from URLs, bearer headers and JWTs inside free text', () => {
    const text = redactText(
      'POST https://portal.bitrix24.vn/rest/1/abcdef0123456789/crm.lead.add?auth=SECRETAUTH&start=0 ' +
        'failed with Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl ' +
        'and https://user:pa55word@redis.internal:6379/0 refresh_token=RT-XYZ',
    );

    for (const secret of [
      'abcdef0123456789',
      'SECRETAUTH',
      'eyJhbGciOiJIUzI1NiJ9',
      'pa55word',
      'RT-XYZ',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('https://portal.bitrix24.vn/rest/1/');
    expect(text).toContain('crm.lead.add');
    expect(text).toContain('start=0');
  });

  it('redacts errors including their cause chain and extra fields', () => {
    const cause = Object.assign(new Error('token=abc123 rejected for person@example.com'), {
      code: 'EAUTH',
      config: { headers: { Authorization: 'Bearer zzz' } },
    });
    const error = new Error('upstream failed', { cause });

    const output = redact({ error }) as { error: Record<string, unknown> };

    expect(output.error).toMatchObject({
      name: 'Error',
      message: 'upstream failed',
      cause: {
        name: 'Error',
        code: 'EAUTH',
        config: { headers: { Authorization: REDACTED } },
      },
    });
    const text = JSON.stringify(output);
    expect(text).not.toContain('abc123');
    expect(text).not.toContain('person@example.com');
    expect(text).not.toContain('zzz');
    expect(text).not.toContain('at Object.');
  });

  it('survives cycles, deep nesting and exotic values', () => {
    const cyclic: Record<string, unknown> = {
      id: '018f0000-0000-7000-8000-000000000001',
      count: 3,
    };
    cyclic.self = cyclic;
    let deep: Record<string, unknown> = { leaf: true };
    for (let index = 0; index < 30; index += 1) deep = { deep };

    expect(redact(cyclic)).toEqual({
      id: '018f0000-0000-7000-8000-000000000001',
      count: 3,
      self: '[Circular]',
    });
    expect(JSON.stringify(redact(deep))).toContain('[Truncated]');
    expect(redact([1n, undefined, null, true, new Date('2026-01-01T00:00:00Z')])).toEqual([
      '1',
      undefined,
      null,
      true,
      '2026-01-01T00:00:00.000Z',
    ]);
    expect(redact(Buffer.from('secret'))).toBe('[Buffer 6 bytes]');
  });

  it('keeps identifiers and ordinary numbers readable', () => {
    expect(
      redact({ leadId: '1790000000000000001', attempt: 3, operationKey: 'bitrix-lead-sync/x/2' }),
    ).toEqual({ leadId: '1790000000000000001', attempt: 3, operationKey: 'bitrix-lead-sync/x/2' });
  });
});

describe('integration logger', () => {
  afterEach(() => jest.restoreAllMocks());

  it('writes one redacted JSON line per event', () => {
    const lines: string[] = [];
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    new IntegrationLogger('Probe').warn('bitrix.call_failed', {
      method: 'crm.item.add',
      reason: 'https://p.bitrix24.vn/rest/1/s3cr3tt0ken99/ said no to a@b.co',
      error: new Error('Bearer abc.def.ghi'),
      token: 'zzz',
    });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      event: 'bitrix.call_failed',
      method: 'crm.item.add',
      token: REDACTED,
    });
    for (const secret of ['s3cr3tt0ken99', 'a@b.co', 'abc.def.ghi', 'zzz']) {
      expect(lines[0]).not.toContain(secret);
    }
  });
});

describe('integration metrics', () => {
  it('keeps the latest value per metric and drops high-cardinality labels', () => {
    const metrics = new IntegrationMetrics();

    metrics.record('queue_oldest_pending_seconds', 12, { queue: 'tiktok-ingest', leadId: 'x' });
    metrics.record('queue_oldest_pending_seconds', 40, { queue: 'tiktok-ingest', email: 'a@b.co' });
    metrics.record('operations_total', 3, { status: 'dead_letter', kind: 'bitrix_lead_sync' });

    expect(metrics.snapshot()).toEqual([
      { name: 'queue_oldest_pending_seconds', value: 40, labels: { queue: 'tiktok-ingest' } },
      {
        name: 'operations_total',
        value: 3,
        labels: { status: 'dead_letter', kind: 'bitrix_lead_sync' },
      },
    ]);
  });
});
