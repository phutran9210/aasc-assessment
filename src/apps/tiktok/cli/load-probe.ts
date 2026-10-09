import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { assertMockMode, demoOptionsFromEnvironment } from './demo-environment.js';
import { demoLeadPayload, sendSignedWebhook } from './demo-flow.js';
import { percentile } from './statistics.js';

function boundedInteger(name: string, fallback: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${name} must be an integer from 1 to ${max}`);
  }
  return value;
}

/**
 * Measures webhook acknowledgement latency against a mock deployment. The default of 50 requests
 * stays under the per-advertiser limit of 120 per minute; responses with 429 are reported, not
 * retried.
 */
async function main(): Promise<void> {
  assertMockMode();
  const options = demoOptionsFromEnvironment();
  const total = boundedInteger('TIKTOK_PROBE_COUNT', 50, 5_000);
  const concurrency = boundedInteger('TIKTOK_PROBE_CONCURRENCY', 5, 50);
  const latencies: number[] = [];
  const statuses = new Map<number, number>();
  let next = 0;

  const startedAt = performance.now();
  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, async () => {
      while (next < total) {
        next += 1;
        const payload = demoLeadPayload(options.advertiserId, `probe-${randomUUID()}`);
        const sentAt = performance.now();
        const response = await sendSignedWebhook(
          options.apiBaseUrl,
          options.webhookSecret,
          payload,
        );
        await response.arrayBuffer();
        latencies.push(performance.now() - sentAt);
        statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
      }
    }),
  );
  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  latencies.sort((left, right) => left - right);

  console.log(
    JSON.stringify(
      {
        requests: total,
        concurrency,
        statuses: Object.fromEntries(statuses),
        requestsPerSecond: Number((total / elapsedSeconds).toFixed(1)),
        latencyMs: {
          p50: Number(percentile(latencies, 0.5).toFixed(1)),
          p95: Number(percentile(latencies, 0.95).toFixed(1)),
          max: Number((latencies.at(-1) ?? 0).toFixed(1)),
        },
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(`Load probe failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
});
