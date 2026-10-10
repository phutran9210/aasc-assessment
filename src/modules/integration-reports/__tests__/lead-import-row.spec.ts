import { buildLeadImportRow } from '../domain/lead-import-row.js';

const now = new Date('2026-02-01T00:00:00.000Z');
const valid = {
  source_record_id: 'source-1',
  advertiser_id: 'adv',
  occurred_at: '2026-01-01T10:00:00+07:00',
  full_name: 'A',
  email: 'a@example.test',
  interests: 'one; two;;',
  crm_feedback_allowed: 'TRUE',
};

describe('buildLeadImportRow', () => {
  it('builds a stable event and removes empty optional sections', () => {
    const result = buildLeadImportRow(valid, 'adv', now);
    expect(result).toMatchObject({
      ok: true,
      sourceRecordId: 'source-1',
      eventKey: 'import:source-1',
      occurredAt: new Date('2026-01-01T03:00:00Z'),
    });
    if (!result.ok) throw new Error('expected valid row');
    expect(result.payload).toMatchObject({
      lead_data: { full_name: 'A', email: 'a@example.test', interests: ['one', 'two'] },
      consent: { crm_feedback_allowed: true },
    });
    expect(result.payload).not.toHaveProperty('campaign');
    expect(buildLeadImportRow(valid, 'adv', now)).toMatchObject({
      payloadHash: result.payloadHash,
    });
  });

  it.each([
    [{ ...valid, source_record_id: ' ' }, 'SOURCE_RECORD_ID_MISSING'],
    [{ ...valid, source_record_id: 'x'.repeat(201) }, 'SOURCE_RECORD_ID_INVALID'],
    [{ ...valid, advertiser_id: 'other' }, 'ADVERTISER_MISMATCH'],
    [{ ...valid, occurred_at: '2026-01-01T10:00:00' }, 'OCCURRED_AT_INVALID'],
    [{ ...valid, occurred_at: '2026-03-01T00:00:00Z' }, 'OCCURRED_AT_INVALID'],
  ] as const)('rejects invalid source identity or timestamp', (row, errorCode) => {
    expect(buildLeadImportRow(row, 'adv', now)).toMatchObject({ ok: false, errorCode });
  });

  it('keeps false consent and ignores unrecognized consent values', () => {
    expect(
      buildLeadImportRow({ ...valid, crm_feedback_allowed: 'false' }, 'adv', now),
    ).toMatchObject({ ok: true, payload: { consent: { crm_feedback_allowed: false } } });
    expect(buildLeadImportRow({ ...valid, crm_feedback_allowed: 'yes' }, 'adv', now)).toMatchObject(
      { ok: true, payload: expect.not.objectContaining({ consent: expect.anything() }) },
    );
  });
});
