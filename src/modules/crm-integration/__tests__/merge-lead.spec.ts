import { mergeLead } from '../domain/merge-lead.js';
import type { NormalizedLeadInput } from '../types/normalized-lead.type.js';

const incoming = (patch: Partial<NormalizedLeadInput> = {}): NormalizedLeadInput => ({
  providerLeadId: 'provider-1',
  advertiserId: 'advertiser-1',
  eventKey: 'event-a',
  occurredAt: '2026-10-08T10:00:00.000Z',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: null,
  city: null,
  campaignId: 'campaign-1',
  campaignName: null,
  adId: null,
  adName: null,
  formId: null,
  formName: null,
  ttclid: null,
  utm: {},
  customAnswers: {},
  interests: [],
  consent: {},
  isHistorical: false,
  applyRules: true,
  sendFeedback: true,
  ...patch,
});

describe('mergeLead', () => {
  it('never clears existing values with null or empty input', () => {
    const result = mergeLead(
      {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        phone: '+14155552671',
        city: 'London',
        fieldProvenance: {},
      },
      incoming({ name: '', email: null, phone: null, city: null }),
    );

    expect(result.lead).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '+14155552671',
      city: 'London',
    });
  });

  it('orders updates by occurredAt and resolves equal timestamps by eventKey', () => {
    const current = {
      name: 'Old Name',
      email: 'ada@example.com',
      phone: null,
      city: null,
      fieldProvenance: { name: { occurredAt: '2026-10-08T10:00:00.000Z', eventKey: 'event-z' } },
    };
    const earlier = mergeLead(
      current,
      incoming({ name: 'Earlier', occurredAt: '2026-10-07T10:00:00.000Z' }),
    );
    const tie = mergeLead(current, incoming({ name: 'Tie Winner', eventKey: 'event-a' }));
    const reverseTie = mergeLead(
      {
        ...current,
        name: 'Tie Winner',
        fieldProvenance: { name: { occurredAt: '2026-10-08T10:00:00.000Z', eventKey: 'event-a' } },
      },
      incoming({ name: 'Old Name', eventKey: 'event-z' }),
    );

    expect(earlier.lead.name).toBe('Old Name');
    expect(tie.lead.name).toBe('Tie Winner');
    expect(reverseTie.lead.name).toBe('Tie Winner');
  });

  it('unions interests with a 100 item cap', () => {
    const result = mergeLead(
      {
        name: 'Ada',
        email: null,
        phone: null,
        city: null,
        interests: ['one'],
        fieldProvenance: {},
      },
      incoming({ email: null, interests: Array.from({ length: 101 }, (_, index) => `i${index}`) }),
    );

    expect(result.lead.interests).toHaveLength(100);
    expect(result.lead.interests?.[0]).toBe('one');
  });
});
