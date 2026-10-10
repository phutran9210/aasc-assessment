import { randomUUID } from 'node:crypto';

import { assertMockMode, demoOptionsFromEnvironment, readSample } from './demo-environment.js';
import { demoLeadPayload, sendSignedWebhook } from './demo-flow.js';

/**
 * Sends one signed lead webhook. `TIKTOK_DEMO_SAMPLE` may point to a JSON payload such as
 * samples/tiktok/lead-generate.json; its advertiser, event id and timestamp are replaced so the
 * request is accepted by this deployment, is not a duplicate of an earlier run and shows up in the
 * current reporting period.
 */
async function main(): Promise<void> {
  assertMockMode();
  const options = demoOptionsFromEnvironment();
  const eventId = `cli-${randomUUID()}`;
  const samplePath = process.env.TIKTOK_DEMO_SAMPLE;
  const payload = samplePath
    ? {
        ...(await readSample(samplePath)),
        advertiser_id: options.advertiserId,
        event_id: eventId,
        timestamp: Math.floor(Date.now() / 1000),
      }
    : demoLeadPayload(options.advertiserId, eventId);

  const response = await sendSignedWebhook(options.apiBaseUrl, options.webhookSecret, payload);
  console.log(`HTTP ${response.status} ${await response.text()}`);
  if (!response.ok) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(`Webhook failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
});
