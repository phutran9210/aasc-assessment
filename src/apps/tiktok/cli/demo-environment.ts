import { readFile } from 'node:fs/promises';

import { DEMO_PASSWORD } from '../database/seed.js';
import type { DemoOptions } from './demo-flow.js';

/** Fails with a clear message instead of sending demo traffic to a real account. */
export function assertMockMode(): void {
  const tiktok = process.env.TIKTOK_MODE ?? 'mock';
  const bitrix = process.env.BITRIX_INTEGRATION_MODE ?? 'mock';
  if (tiktok !== 'mock' || bitrix !== 'mock') {
    throw new Error(
      `Demo tools only run in mock mode (TIKTOK_MODE=${tiktok}, BITRIX_INTEGRATION_MODE=${bitrix})`,
    );
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** Demo settings come from the environment only; credentials are never taken from argv. */
export function demoOptionsFromEnvironment(): DemoOptions {
  return {
    apiBaseUrl: (process.env.TIKTOK_DEMO_BASE_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, ''),
    bitrixRestUrl: required('TIKTOK_BITRIX24_WEBHOOK_URL'),
    advertiserId: required('TIKTOK_ADVERTISER_ID'),
    portalKey: process.env.BITRIX_PORTAL_KEY ?? 'mock-portal',
    webhookSecret: required('TIKTOK_WEBHOOK_SECRET'),
    bitrixEventSecret: required('BITRIX_MOCK_EVENT_SECRET'),
    username: process.env.TIKTOK_DEMO_USERNAME ?? 'demo-admin',
    password: process.env.TIKTOK_DEMO_PASSWORD ?? DEMO_PASSWORD,
    reportTimezone: process.env.REPORT_TIMEZONE,
    timeoutMs: Number(process.env.TIKTOK_DEMO_TIMEOUT_MS ?? 120_000),
  };
}

export async function readSample(path: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The sample file must contain one JSON object');
  }
  return parsed as Record<string, unknown>;
}
