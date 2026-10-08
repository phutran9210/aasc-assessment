import { BadRequestException } from '@nestjs/common';

import { parseWebhookEnvelope } from '../domain/webhook-envelope.js';

describe('parseWebhookEnvelope', () => {
  it('rejects incomplete lead generation payloads', () => {
    expect(() =>
      parseWebhookEnvelope({
        event_id: 'event-1',
        event: 'lead.generate',
        advertiser_id: 'advertiser-1',
        timestamp: '2026-10-09T00:00:00.000Z',
      }),
    ).toThrow(BadRequestException);
  });
});
