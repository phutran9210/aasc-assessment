import { normalizeLead } from '../domain/normalize-lead.js';
import type { ProviderLead } from '@modules/tiktok/types/index.js';

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

  it('reads the nested ad, the UTM values and the questions of the assignment payload', () => {
    const payload = {
      event: 'lead.generate',
      event_id: 'evt_1234567890',
      timestamp: 1709876543,
      advertiser_id: '7123456789',
      campaign: {
        campaign_id: '1234567890123456789',
        campaign_name: 'Spring Sale 2024',
        ad_id: '9876543210987654321',
        ad_name: 'Product Demo Video',
      },
      form: { form_id: 'form_abc123', form_name: 'Contact Form' },
      lead_data: {
        full_name: 'Nguyễn Văn A',
        email: 'nguyenvana@email.com',
        phone: '+84901234567',
        city: 'Hà Nội',
        interests: ['technology', 'mobile apps'],
        utm_source: 'tiktok',
        utm_campaign: 'spring_sale_2024',
        ttclid: 'TT-abc123xyz789',
      },
      custom_questions: [
        { question: 'Budget range', answer: '5-10 triệu VND' },
        { question: 'Timeline', answer: 'Trong 1 tháng' },
      ],
    };
    const result = normalizeLead(
      {
        id: '',
        advertiserId: '7123456789',
        eventKey: 'evt_1234567890',
        occurredAt: '2024-03-08T05:42:23.000Z',
        fields: payload,
      },
      'VN',
    );

    expect(result).toMatchObject({
      kind: 'valid',
      data: {
        name: 'Nguyễn Văn A',
        email: 'nguyenvana@email.com',
        phone: '+84901234567',
        city: 'Hà Nội',
        campaignId: '1234567890123456789',
        campaignName: 'Spring Sale 2024',
        adId: '9876543210987654321',
        adName: 'Product Demo Video',
        formId: 'form_abc123',
        formName: 'Contact Form',
        ttclid: 'TT-abc123xyz789',
        utm: { utm_source: 'tiktok', utm_campaign: 'spring_sale_2024' },
        interests: ['technology', 'mobile apps'],
        customAnswers: { 'Budget range': '5-10 triệu VND', Timeline: 'Trong 1 tháng' },
      },
    });
  });

  it('uses nested lead data and explicit campaign, ad, and form values before field fallbacks', () => {
    const result = normalizeLead(
      {
        ...vnFixture,
        campaign: { id: 'campaign-explicit', name: 'Explicit campaign' },
        ad: { id: 'ad-explicit', name: 'Explicit ad' },
        form: { id: 'form-explicit', name: 'Explicit form' },
        fields: {
          lead_data: {
            full_name: 'Nested Name',
            email: 'nested@example.test',
            timestamp: '2024-04-02T03:04:05Z',
          },
          full_name: 'Fallback Name',
          email: 'fallback@example.test',
          campaign: { id: 'campaign-fallback', name: 'Fallback campaign' },
          ad: { id: 'ad-fallback', name: 'Fallback ad' },
          form: { id: 'form-fallback', name: 'Fallback form' },
        },
        occurredAt: undefined,
      },
      'VN',
    );

    expect(result).toMatchObject({
      kind: 'valid',
      data: {
        name: 'Nested Name',
        email: 'nested@example.test',
        occurredAt: '2024-04-02T03:04:05.000Z',
        campaignId: 'campaign-explicit',
        campaignName: 'Explicit campaign',
        adId: 'ad-explicit',
        adName: 'Explicit ad',
        formId: 'form-explicit',
        formName: 'Explicit form',
      },
    });
  });

  it('rejects invalid attribution IDs and filters unsafe UTM keys and values', () => {
    const result = normalizeLead(
      {
        ...vnFixture,
        id: ' ',
        eventKey: '',
        occurredAt: 'not-a-date',
        fields: {
          full_name: 'An',
          email: 'an@example.test',
          campaign_id: ' '.repeat(3),
          utm: {
            source: ' TikTok ',
            constructor: 'unsafe',
            'invalid.key': 'unsafe',
            empty: ' ',
            count: 42,
          },
        },
      },
      'VN',
    );

    expect(result).toMatchObject({
      kind: 'valid',
      warnings: ['PROVIDER_LEAD_ID_INVALID', 'ATTRIBUTION_ID_INVALID'],
      data: {
        providerLeadId: null,
        eventKey: '',
        occurredAt: null,
        campaignId: null,
        utm: { source: 'TikTok' },
      },
    });
  });

  it('normalizes answer objects and arrays while discarding unsafe keys and excess depth', () => {
    const result = normalizeLead(
      {
        ...vnFixture,
        fields: {
          full_name: 'An',
          email: 'an@example.test',
          custom_questions: {
            preferences: {
              interests: [' CRM ', true, Number.POSITIVE_INFINITY],
              nested: { one: { two: { three: { four: { five: 'too deep' } } } } },
              constructor: 'unsafe',
            },
            empty: undefined,
          },
        },
      },
      'VN',
    );

    expect(result).toMatchObject({
      kind: 'valid',
      data: {
        customAnswers: {
          preferences: {
            interests: ['CRM', true, null],
            nested: { one: { two: { three: { four: null } } } },
          },
          empty: null,
        },
      },
    });
  });

  it('ignores malformed question entries and deduplicates normalized interests', () => {
    const result = normalizeLead(
      {
        ...vnFixture,
        fields: {
          full_name: 'An',
          email: 'an@example.test',
          custom_questions: [
            { question_id: 'valid', answer: [' A ', 'B'] },
            { question_id: 'missing-answer' },
            { question_id: 'prototype', answer: 'unsafe' },
            null,
          ],
          interests: [' CRM ', 'CRM', null, 'Sales'],
        },
      },
      'VN',
    );

    expect(result).toMatchObject({
      kind: 'valid',
      data: { customAnswers: { valid: ['A', 'B'] }, interests: ['CRM', 'Sales'] },
    });
  });

  it('defaults historical events to no rules or feedback unless explicitly enabled', () => {
    const result = normalizeLead(
      {
        ...vnFixture,
        isHistorical: true,
        fields: { full_name: 'An', email: 'an@example.test' },
      },
      'VN',
    );

    expect(result).toMatchObject({
      kind: 'valid',
      data: { isHistorical: true, applyRules: false, sendFeedback: false },
    });
  });

  it('rejects oversized provider identifiers without losing a valid contact', () => {
    const result = normalizeLead(
      {
        ...vnFixture,
        id: 'L'.repeat(256),
        advertiserId: 'A'.repeat(256),
        fields: {
          full_name: 'An',
          email: 'an@example.test',
          campaign_id: 'C'.repeat(256),
        },
      },
      'VN',
    );

    expect(result).toMatchObject({
      kind: 'valid',
      warnings: ['PROVIDER_LEAD_ID_INVALID', 'ATTRIBUTION_ID_INVALID'],
      data: { providerLeadId: null, advertiserId: '', campaignId: null },
    });
  });

  it('uses a null timestamp and keeps finite or blank custom answers safely', () => {
    const result = normalizeLead(
      {
        ...vnFixture,
        occurredAt: undefined,
        fields: {
          full_name: 'An',
          email: 'an@example.test',
          custom_questions: {
            budget: 25,
            note: '   ',
            ['Q'.repeat(256)]: 'ignored',
          },
        },
      },
      'VN',
    );

    expect(result).toMatchObject({
      kind: 'valid',
      data: { occurredAt: null, customAnswers: { budget: 25, note: '' } },
    });
    if (result.kind === 'valid') expect(Object.keys(result.data.customAnswers)).toHaveLength(2);
  });
});
