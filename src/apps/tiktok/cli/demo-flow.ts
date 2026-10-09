import { createHmac, randomUUID } from 'node:crypto';

import { Temporal } from '@common/utils/temporal.util.js';
import { DEMO_CAMPAIGN_ID, DEMO_MAPPING } from '../database/seed.js';

export type DemoOptions = {
  /** Base URL of the integration API, for example http://127.0.0.1:3001. */
  apiBaseUrl: string;
  /** REST endpoint of the Bitrix24 mock, ending in a slash. */
  bitrixRestUrl: string;
  advertiserId: string;
  portalKey: string;
  webhookSecret: string;
  bitrixEventSecret: string;
  username: string;
  password: string;
  reportTimezone?: string;
  timeoutMs?: number;
};

type Lead = { id: string; email: string | null; syncStatus: string; bitrixLeadId: string | null };
type Deal = {
  id: string;
  leadId: string;
  bitrixDealId: string | null;
  stageSemantics: string;
  conversionStatus: string;
  amount: string | null;
};

export type DemoSummary = {
  health: string;
  eventId: string;
  lead: Lead;
  deal: Deal;
  analytics: Record<string, unknown>;
  campaign: Record<string, unknown>;
  exports: { csv: { bytes: number }; json: { rows: number }; xlsx: { bytes: number } };
};

const POLL_INTERVAL_MS = 750;
const DEMO_DEAL_AMOUNT = 1_500_000;

/** Signs a webhook body the way the mock TikTok provider does: HMAC-SHA256 over `<t>.<body>`. */
export function signWebhook(secret: string, body: Buffer, timestamp: number): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
  return `t=${timestamp},s=${digest}`;
}

export function demoLeadPayload(advertiserId: string, eventId: string): Record<string, unknown> {
  return {
    event_id: eventId,
    event: 'lead.generate',
    advertiser_id: advertiserId,
    timestamp: new Date().toISOString(),
    campaign_id: DEMO_CAMPAIGN_ID,
    form_id: 'form-lead-v1',
    lead_data: {
      name: 'Nguyễn An (demo)',
      email: `${eventId}@example.test`,
      phone_number: '+84901234567',
      city: 'Hà Nội',
      custom_questions: [
        { question_id: 'budget', question_text: 'Ngân sách dự kiến', answer: '5-10 triệu VND' },
      ],
    },
    consent: { crm_feedback_allowed: true },
  };
}

export async function sendSignedWebhook(
  apiBaseUrl: string,
  secret: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  return fetch(`${apiBaseUrl}/webhooks/tiktok/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'TikTok-Signature': signWebhook(secret, body, Math.floor(Date.now() / 1000)),
    },
    body,
  });
}

/**
 * The acceptance walk-through against mock providers: one signed webhook becomes one CRM lead,
 * the rule creates one deal, the deal is won in the mock CRM, and the result shows up in
 * analytics and in the CSV, JSON and XLSX exports. Every step goes through the public HTTP API.
 */
export async function runDemo(
  options: DemoOptions,
  log: (line: string) => void = () => undefined,
): Promise<DemoSummary> {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  const api = (path: string) => `${options.apiBaseUrl}${path}`;

  const health = await expectJson<{ status: string }>(await fetch(api('/health')), 'health check');
  log(`health: ${health.status}`);

  const login = await expectJson<{ accessToken: string }>(
    await fetch(api('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: options.username, password: options.password }),
    }),
    'login',
  );
  const authorization = { Authorization: `Bearer ${login.accessToken}` };
  const get = async <T>(path: string): Promise<T> => {
    for (;;) {
      const response = await fetch(api(path), { headers: authorization });
      if (response.status !== 429) return expectJson<T>(response, `GET ${path}`);
      await sleep(Number(response.headers.get('retry-after') ?? 1) * 1000);
    }
  };
  const poll = async <T>(what: string, read: () => Promise<T | undefined>): Promise<T> => {
    for (;;) {
      const value = await read();
      if (value !== undefined) return value;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
      await sleep(POLL_INTERVAL_MS);
    }
  };

  const mapping = await fetch(api('/configuration/mapping'), { headers: authorization });
  if (mapping.status === 404) {
    await expectJson(
      await fetch(api('/configuration/mapping'), {
        method: 'PUT',
        headers: { ...authorization, 'Content-Type': 'application/json', 'If-Match': '"0"' },
        body: JSON.stringify({ value: DEMO_MAPPING }),
      }),
      'mapping configuration',
    );
    log('mapping: stored the demo field mapping');
  }

  const eventId = `demo-${randomUUID()}`;
  const payload = demoLeadPayload(options.advertiserId, eventId);
  const email = (payload.lead_data as { email: string }).email;
  await expectJson(
    await sendSignedWebhook(options.apiBaseUrl, options.webhookSecret, payload),
    'signed webhook',
  );
  log(`webhook: accepted ${eventId}`);

  const lead = await poll('the lead to reach Bitrix24', async () =>
    (await get<{ items: Lead[] }>('/api/v1/leads?limit=100')).items.find(
      (item) => item.email === email && item.syncStatus === 'synced' && item.bitrixLeadId,
    ),
  );
  log(`lead: ${lead.id} → Bitrix lead ${lead.bitrixLeadId}`);

  const created = await poll('the rule to create a deal', async () =>
    (await get<{ items: Deal[] }>('/api/v1/deals?limit=100')).items.find(
      (item) =>
        item.leadId === lead.id && item.conversionStatus === 'completed' && item.bitrixDealId,
    ),
  );
  log(`deal: ${created.id} → Bitrix deal ${created.bitrixDealId}`);

  await expectJson(
    await fetch(`${options.bitrixRestUrl}crm.item.update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityTypeId: 2,
        id: created.bitrixDealId,
        fields: { stageId: 'C1:WON', opportunity: DEMO_DEAL_AMOUNT, currencyId: 'VND' },
      }),
    }),
    'mock deal update',
  );
  await expectJson(
    await fetch(api('/webhooks/bitrix24/deals'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mock-Bitrix-Secret': options.bitrixEventSecret,
      },
      body: JSON.stringify({
        event_id: `demo-deal-${randomUUID()}`,
        event: 'deal.update',
        portal_key: options.portalKey,
        deal_id: created.bitrixDealId,
        timestamp: new Date().toISOString(),
      }),
    }),
    'deal callback',
  );
  const deal = await poll('the deal to be won', async () =>
    (await get<{ items: Deal[] }>('/api/v1/deals?limit=100')).items.find(
      (item) => item.id === created.id && item.stageSemantics === 'won',
    ),
  );
  log(`deal: won for ${deal.amount ?? '?'} VND`);

  const campaignQuery = `campaign_id=${encodeURIComponent(DEMO_CAMPAIGN_ID)}`;
  const analytics = await poll('analytics to show the won deal', async () => {
    const rates = await get<Record<string, unknown>>(
      `/api/v1/analytics/conversion-rates?${campaignQuery}`,
    );
    return Number(rates.wonLeads) >= 1 ? rates : undefined;
  });
  // Campaign performance works on whole days; today is included explicitly for the demo lead.
  const today = Temporal.Now.zonedDateTimeISO(
    options.reportTimezone ?? 'Asia/Ho_Chi_Minh',
  ).toPlainDate();
  const performance = await get<{ items: Array<Record<string, unknown>> }>(
    `/api/v1/analytics/campaign-performance?${campaignQuery}&from=${today.toString()}&to=${today
      .add({ days: 1 })
      .toString()}`,
  );
  log(
    `analytics: ${String(analytics.leads)} lead(s), ${String(analytics.wonLeads)} won, ` +
      `lead→won ${String(analytics.leadToWonRate)}%`,
  );

  const download = async (format: string): Promise<Buffer> => {
    const response = await fetch(api(`/api/v1/reports/export?format=${format}`), {
      headers: authorization,
    });
    if (!response.ok) throw new Error(`Export ${format} failed with HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  };
  const csv = await download('csv');
  const json = JSON.parse((await download('json')).toString('utf8')) as unknown[];
  const xlsx = await download('xlsx');
  log(`exports: csv ${csv.length} bytes, json ${json.length} row(s), xlsx ${xlsx.length} bytes`);

  return {
    health: health.status,
    eventId,
    lead,
    deal,
    analytics,
    campaign: performance.items[0] ?? {},
    exports: {
      csv: { bytes: csv.length },
      json: { rows: json.length },
      xlsx: { bytes: xlsx.length },
    },
  };
}

async function expectJson<T>(response: Response, step: string): Promise<T> {
  if (!response.ok) throw new Error(`${step} failed with HTTP ${response.status}`);
  return (await response.json()) as T;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
