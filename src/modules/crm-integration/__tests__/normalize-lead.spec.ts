import { normalizeLead } from '../domain/normalize-lead.js';
import type { ProviderLead } from '@modules/tiktok/ports/tiktok-lead-provider.port.js';

const vnFixture: ProviderLead = {
  id: 'lead-source-001',
  advertiserId: 'advertiser-001',
  eventKey: 'event-001',
  occurredAt: '2024-03-01T10:15:00.000Z',
  fields: {
    full_name: '  Nguye\u0302\u0303n An  ',
    email: ' Person+tag.Name@Example.Test ',
    phone: '0901234567',
    city: '  Hà Nội  ',
    campaign_id: '001234567890123456789',
    form_id: 'form-001',
    custom_questions: [
      { question_id: 'budget-id', question_text: 'Budget', answer: '5-10 triệu VND' },
    ],
    interests: Array.from({ length: 105 }, (_, index) => `interest-${index}`),
  },
};

describe('normalizeLead', () => {
  it('normalizes Vietnamese contacts, Unicode text, and preserves source identifiers and answers', () => {
    expect(normalizeLead(vnFixture, 'VN')).toMatchObject({
      kind: 'valid',
      data: {
        name: 'Nguyễn An',
        email: 'person+tag.name@example.test',
        phone: '+84901234567',
        city: 'Hà Nội',
        campaignId: '001234567890123456789',
        customAnswers: { 'budget-id': '5-10 triệu VND' },
      },
    });
    const result = normalizeLead(vnFixture, 'VN');
    expect(result.kind).toBe('valid');
    if (result.kind === 'valid') expect(result.data.interests).toHaveLength(100);
  });

  it('normalizes international phones and does not remove plus tags or dots from email identity', () => {
    const result = normalizeLead(
      {
        ...vnFixture,
        fields: {
          full_name: 'Alex User',
          email: 'A.lex+campaign@Example.com',
          phone: '+1 213 373 4253',
        },
      },
      'VN',
    );
    expect(result).toMatchObject({
      kind: 'valid',
      data: { email: 'a.lex+campaign@example.com', phone: '+12133734253' },
    });
  });

  it('drops one invalid contact when the other identity is valid and quarantines when neither is valid', () => {
    const partial = normalizeLead(
      { ...vnFixture, fields: { full_name: 'An', email: 'bad', phone: '0901234567' } },
      'VN',
    );
    expect(partial).toMatchObject({
      kind: 'valid',
      data: { email: null, phone: '+84901234567' },
      warnings: ['EMAIL_INVALID'],
    });
    expect(
      normalizeLead(
        { ...vnFixture, fields: { full_name: 'An', email: 'bad', phone: '123' } },
        'VN',
      ),
    ).toMatchObject({
      kind: 'quarantined',
      reason: 'CONTACT_IDENTIFIER_MISSING',
    });
  });

  it('quarantines missing names, applies field limits, and does not coerce budget text to a number', () => {
    const result = normalizeLead(
      {
        ...vnFixture,
        fields: {
          full_name: ` ${'N'.repeat(260)} `,
          email: 'ok@example.test',
          phone: null,
          city: 'C'.repeat(260),
          custom_questions: [{ question_text: 'Budget', answer: '5-10 triệu VND' }],
          campaign_id: '900719925474099312345',
        },
      },
      'VN',
    );
    expect(result.kind).toBe('valid');
    if (result.kind === 'valid') {
      expect([...result.data.name]).toHaveLength(255);
      expect(result.data.city).toHaveLength(255);
      expect(result.data.customAnswers).toEqual({ Budget: '5-10 triệu VND' });
      expect(result.data.campaignId).toBe('900719925474099312345');
      expect(result.data).not.toHaveProperty('amount');
    }
    expect(
      normalizeLead({ ...vnFixture, fields: { email: 'ok@example.test', phone: null } }, 'VN'),
    ).toMatchObject({
      kind: 'quarantined',
      reason: 'NAME_MISSING',
    });
  });

  it('preserves consent and ingestion flags from the provider record', () => {
    const result = normalizeLead(
      {
        ...vnFixture,
        fields: { full_name: 'An', email: 'ok@example.test' },
        consent: { crm_feedback_allowed: true },
        isHistorical: true,
        applyRules: false,
        sendFeedback: false,
      },
      'VN',
    );
    expect(result).toMatchObject({
      kind: 'valid',
      data: {
        consent: { crm_feedback_allowed: true },
        isHistorical: true,
        applyRules: false,
        sendFeedback: false,
      },
    });
  });

  it('indexes custom answers by exact mock label when a question ID is absent', () => {
    const result = normalizeLead(
      {
        ...vnFixture,
        fields: { full_name: 'An', email: 'ok@example.test' },
        customQuestions: [{ question: 'Ngân sách dự kiến', answer: '5-10 triệu VND' }],
      },
      'VN',
    );
    expect(result).toMatchObject({
      kind: 'valid',
      data: { customAnswers: { 'Ngân sách dự kiến': '5-10 triệu VND' } },
    });
  });

  it('drops prototype control keys from provider custom answers', () => {
    const result = normalizeLead(
      {
        ...vnFixture,
        fields: { full_name: 'An', email: 'ok@example.test' },
        customQuestions: [{ questionId: '__proto__', answer: 'unsafe' }],
      },
      'VN',
    );
    expect(result).toMatchObject({ kind: 'valid', data: { customAnswers: {} } });
  });
});
