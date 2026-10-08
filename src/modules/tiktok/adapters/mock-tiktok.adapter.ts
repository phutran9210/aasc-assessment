import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  CampaignSpendProvider,
  SpendPage,
  SpendRange,
} from '../ports/campaign-spend-provider.port.js';
import type {
  EventResult,
  FeedbackEvent,
  TiktokFeedbackProvider,
} from '../ports/tiktok-feedback-provider.port.js';
import type {
  ProviderLead,
  TiktokLeadProvider,
  VerifiedEvent,
} from '../ports/tiktok-lead-provider.port.js';

export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'ProviderHttpError';
  }
}

export class MockTiktokAdapter
  implements TiktokLeadProvider, TiktokFeedbackProvider, CampaignSpendProvider
{
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly webhookSecret = 'mock-webhook-secret',
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  parseWebhook(raw: Buffer, headers: Record<string, string | undefined>): VerifiedEvent {
    const signature = headers['x-mock-signature'];
    if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) {
      throw new ProviderHttpError(401, 'MOCK_SIGNATURE_INVALID');
    }
    const expected = createHmac('sha256', this.webhookSecret).update(raw).digest();
    const received = Buffer.from(signature, 'hex');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new ProviderHttpError(401, 'MOCK_SIGNATURE_INVALID');
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new ProviderHttpError(400, 'WEBHOOK_JSON_INVALID');
    }
    const event = record(decoded);
    if (
      typeof event.eventKey !== 'string' ||
      typeof event.eventType !== 'string' ||
      typeof event.advertiserId !== 'string'
    ) {
      throw new ProviderHttpError(400, 'WEBHOOK_ENVELOPE_INVALID');
    }
    return {
      eventKey: event.eventKey,
      eventType: event.eventType,
      advertiserId: event.advertiserId,
      occurredAt: typeof event.occurredAt === 'string' ? event.occurredAt : null,
      payload: record(event.payload),
    };
  }

  getLeadDetail(id: string): Promise<ProviderLead> {
    return this.request(`/leads/${encodeURIComponent(id)}`);
  }

  async sendEvents(events: FeedbackEvent[]): Promise<EventResult[]> {
    const response = await this.request<{ results: EventResult[] }>(
      '/events',
      {
        method: 'POST',
        body: JSON.stringify({ events }),
      },
      true,
    );
    if (!Array.isArray(response.results))
      throw new ProviderHttpError(502, 'FEEDBACK_RESPONSE_INVALID');
    return response.results.map((item) => {
      if (
        !item ||
        typeof item.eventId !== 'string' ||
        (item.status !== 'accepted' && item.status !== 'rejected')
      ) {
        throw new ProviderHttpError(502, 'FEEDBACK_RESULT_INVALID');
      }
      return item;
    });
  }

  async fetchSpend(range: SpendRange, cursor?: string): Promise<SpendPage> {
    const query = new URLSearchParams({ from: range.from, to: range.to });
    if (range.campaignId) query.set('campaignId', range.campaignId);
    if (cursor) query.set('cursor', cursor);
    const page = await this.request<SpendPage>(`/spend?${query.toString()}`);
    if (!Array.isArray(page.items)) throw new ProviderHttpError(502, 'SPEND_RESPONSE_INVALID');
    for (const row of page.items) {
      if (
        typeof row.campaignId !== 'string' ||
        typeof row.date !== 'string' ||
        typeof row.amount !== 'string' ||
        typeof row.currency !== 'string'
      ) {
        throw new ProviderHttpError(502, 'SPEND_ROW_INVALID');
      }
    }
    return page;
  }

  private async request<T>(path: string, init: RequestInit = {}, allowPartial = false): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          ...init.headers,
        },
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new ProviderHttpError(503, 'PROVIDER_UNAVAILABLE');
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ProviderHttpError(502, 'PROVIDER_RESPONSE_INVALID');
    }
    if (!response.ok && !(allowPartial && response.status === 207)) {
      const value = record(body);
      throw new ProviderHttpError(
        response.status,
        typeof value.code === 'string' ? value.code : 'PROVIDER_ERROR',
      );
    }
    return body as T;
  }
}

export function createMockWebhookSignature(raw: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(raw).digest('hex');
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
