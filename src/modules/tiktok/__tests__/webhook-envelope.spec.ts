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

  // The payload printed in the assignment: Unix seconds, and campaign and form IDs nested.
  const assignmentPayload = {
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

  it('accepts the sample payload of the assignment as it is', () => {
    expect(parseWebhookEnvelope(assignmentPayload)).toMatchObject({
      eventId: 'evt_1234567890',
      eventType: 'lead.generate',
      advertiserId: '7123456789',
      occurredAt: new Date('2024-03-08T05:42:23.000Z'),
      payload: assignmentPayload,
    });
  });

  it('reads a numeric timestamp in milliseconds too and rejects one that is not a time', () => {
    expect(
      parseWebhookEnvelope({ ...assignmentPayload, timestamp: 1709876543000 }).occurredAt,
    ).toEqual(new Date('2024-03-08T05:42:23.000Z'));
    expect(() => parseWebhookEnvelope({ ...assignmentPayload, timestamp: -1 })).toThrow(
      BadRequestException,
    );
  });

  it('still requires a campaign and a form on a lead in either shape', () => {
    expect(() => parseWebhookEnvelope({ ...assignmentPayload, campaign: {} })).toThrow(
      BadRequestException,
    );
    expect(() => parseWebhookEnvelope({ ...assignmentPayload, form: undefined })).toThrow(
      BadRequestException,
    );
  });
});
