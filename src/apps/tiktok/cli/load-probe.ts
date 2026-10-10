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
 * retried. With `TIKTOK_PROBE_RATE` requests start at that fixed rate per second for
 * `TIKTOK_PROBE_SECONDS`, independent of how fast responses return (open-loop load).
 */
export async function runLoadProbe(): Promise<void> {
  assertMockMode();
  const options = demoOptionsFromEnvironment();
  const rate = process.env.TIKTOK_PROBE_RATE ? boundedInteger('TIKTOK_PROBE_RATE', 20, 500) : 0;
  const seconds = boundedInteger('TIKTOK_PROBE_SECONDS', 60, 3_600);
  const total = rate ? rate * seconds : boundedInteger('TIKTOK_PROBE_COUNT', 50, 5_000);
  const concurrency = boundedInteger('TIKTOK_PROBE_CONCURRENCY', 5, 50);
  const latencies: number[] = [];
  const statuses = new Map<number, number>();
  let failures = 0;

  const send = async (): Promise<void> => {
    const payload = demoLeadPayload(options.advertiserId, `probe-${randomUUID()}`);
    const sentAt = performance.now();
    try {
      const response = await sendSignedWebhook(options.apiBaseUrl, options.webhookSecret, payload);
      await response.arrayBuffer();
      latencies.push(performance.now() - sentAt);
      statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
    } catch {
      failures += 1;
    }
  };

  const startedAt = performance.now();
  if (rate) {
    const inFlight: Array<Promise<void>> = [];
    for (let index = 0; index < total; index += 1) {
      const dueAt = startedAt + (index * 1000) / rate;
      const wait = dueAt - performance.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      inFlight.push(send());
    }
    await Promise.all(inFlight);
  } else {
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, total) }, async () => {
        while (next < total) {
          next += 1;
          await send();
        }
      }),
    );
  }
  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  latencies.sort((left, right) => left - right);

  console.log(
    JSON.stringify(
      {
        requests: total,
        mode: rate ? `${rate} requests/second for ${seconds}s` : `concurrency ${concurrency}`,
        transportFailures: failures,
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

if (process.argv[1]?.endsWith('/load-probe.js')) {
  void runLoadProbe().catch((error: unknown) => {
    console.error(`Load probe failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}
