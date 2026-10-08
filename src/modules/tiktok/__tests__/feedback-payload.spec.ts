import { createHash } from 'node:crypto';

import { buildFeedback, type FeedbackInput } from '../domain/feedback-payload.js';
import type { FeedbackPolicy } from '../../crm-integration/types/rule.types.js';

const policy: FeedbackPolicy = {
  enabled: true,
  event_mapping: { lead_qualified: 'QualifiedLead' },
  matching_keys: ['email', 'phone', 'ttclid'],
  hash_email: true,
  hash_phone: false,
};

const input = {
  advertiserId: 'advertiser-1',
  leadId: 'lead-1',
  milestone: 'lead_qualified',
  occurredAt: new Date('2026-10-09T00:00:00.000Z'),
  consented: true,
  providerMode: 'mock',
  email: 'Person@Example.com',
  phone: '+84901234567',
  ttclid: 'click-1',
  customAnswers: { secret: 'must-not-leak' },
} satisfies FeedbackInput & { customAnswers: Record<string, string> };

describe('buildFeedback', () => {
  it('skips without consent and does not build a provider payload', () => {
    expect(buildFeedback({ ...input, consented: false }, policy)).toEqual({
      status: 'skipped_no_consent',
      reason: 'consent_missing',
    });
  });

  it('builds only mapped events and explicitly allowed matching keys', () => {
    const result = buildFeedback(input, policy);

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('expected feedback payload');
    expect(result.event.eventId).toBe(
      createHash('sha256').update('advertiser-1\0lead-1\0lead_qualified').digest('hex'),
    );
    expect(result.event.payload).toEqual({
      event: 'QualifiedLead',
      eventSource: 'crm',
      eventSourceId: 'advertiser-1',
      eventTime: '2026-10-09T00:00:00.000Z',
      context: {
        user: {
          email: createHash('sha256').update('person@example.com').digest('hex'),
          phone: '+84901234567',
          ttclid: 'click-1',
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    expect(JSON.stringify(result)).not.toContain('Person@Example.com');
  });

  it('does not expose internal milestones when external mapping is missing', () => {
    expect(buildFeedback(input, { enabled: true })).toEqual({
      status: 'disabled',
      reason: 'event_mapping_missing',
    });
  });

  it('keeps the same event ID across retries and repeated milestone scheduling', () => {
    const first = buildFeedback(input, policy);
    const retry = buildFeedback(
      { ...input, occurredAt: new Date('2026-10-10T00:00:00.000Z') },
      policy,
    );

    expect(first.status).toBe('ready');
    expect(retry.status).toBe('ready');
    if (first.status !== 'ready' || retry.status !== 'ready') return;
    expect(retry.event.eventId).toBe(first.event.eventId);
  });
});
