import type { EventResult, FeedbackEvent } from '../ports/tiktok-feedback-provider.port.js';
import type { ProviderLead } from '../ports/tiktok-lead-provider.port.js';
import type { SpendPage } from '../ports/campaign-spend-provider.port.js';
import type { ProviderFault } from './bitrix-store.js';

export type MockProviderResponse = { status: number; body: unknown };
export type TiktokFault =
  Exclude<ProviderFault, 'persist_then_timeout' | 'stale_snapshot'> | 'partial_feedback';

export class TiktokStore {
  private readonly leads = new Map<string, ProviderLead>();
  private spendPages: SpendPage[] = [];
  private feedbackResult: EventResult[] | undefined;
  private readonly faults = new Map<string, TiktokFault[]>();
  readonly calls: Array<{ method: string; payload?: unknown }> = [];

  setLead(lead: ProviderLead): void {
    this.leads.set(lead.id, structuredClone(lead));
  }

  setSpendPages(pages: SpendPage[]): void {
    this.spendPages = structuredClone(pages);
  }

  setNextFeedbackResult(result: EventResult[]): void {
    this.feedbackResult = structuredClone(result);
  }

  injectFault(method: string, fault: TiktokFault): void {
    const queue = this.faults.get(method) ?? [];
    queue.push(fault);
    this.faults.set(method, queue);
  }

  execute(
    method: 'lead' | 'spend' | 'feedback',
    input: { id?: string; cursor?: string; events?: FeedbackEvent[] } = {},
  ): MockProviderResponse {
    this.calls.push({ method, payload: structuredClone(input) });
    const fault = this.faults.get(method)?.shift();
    if (fault === 'auth_invalid') return { status: 401, body: { code: 'AUTH_INVALID' } };
    if (fault === 'rate_limit')
      return { status: 429, body: { code: 'RATE_LIMITED', retryAfter: 30 } };
    if (method === 'lead') {
      const lead = input.id ? this.leads.get(input.id) : undefined;
      return lead ? { status: 200, body: lead } : { status: 404, body: { code: 'LEAD_NOT_FOUND' } };
    }
    if (method === 'spend') {
      const index = input.cursor ? Number(input.cursor.replace('page-', '')) - 1 : 0;
      const page = this.spendPages[index];
      return page ? { status: 200, body: page } : { status: 200, body: { items: [] } };
    }
    if (fault === 'partial_feedback') {
      return { status: 207, body: { results: this.feedbackResult ?? [] } };
    }
    const results =
      this.feedbackResult ??
      (input.events ?? []).map((event) => ({
        eventId: event.eventId,
        status: 'accepted' as const,
      }));
    this.feedbackResult = undefined;
    return { status: 200, body: { results } };
  }
}
