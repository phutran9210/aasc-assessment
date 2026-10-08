import type { BitrixInstallEvent } from '../types/index.js';

/** Converts JSON, nested form fields, and Bitrix's flat `auth[key]` form into one event shape. */
export function normalizeInstallPayload(body: Record<string, unknown>): BitrixInstallEvent {
  if (isRecord(body.auth)) {
    const auth = { ...body.auth };
    if (typeof auth.expires_in === 'string') auth.expires_in = Number(auth.expires_in);
    return { ...body, auth } as unknown as BitrixInstallEvent;
  }

  const data: Record<string, unknown> = {};
  const auth: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    const dataMatch = /^data\[([^\]]+)\]$/.exec(key);
    const authMatch = /^auth\[([^\]]+)\]$/.exec(key);
    if (dataMatch) data[dataMatch[1]] = value;
    if (authMatch) auth[authMatch[1]] = value;
  }
  if (typeof auth.expires_in === 'string') auth.expires_in = Number(auth.expires_in);
  return {
    event: typeof body.event === 'string' ? body.event : '',
    data,
    ts: typeof body.ts === 'string' ? body.ts : '',
    auth: auth as unknown as BitrixInstallEvent['auth'],
  };
}

/** Rejects callback-controlled endpoints before any token is sent to `app.info`. */
export function validateBitrixInstallEvent(
  event: BitrixInstallEvent,
  allowedPortalDomain?: string,
): boolean {
  const auth = event.auth;
  if (!auth || !auth.domain || !auth.client_endpoint || !auth.server_endpoint) return false;
  const domain = auth.domain.toLowerCase();
  if (allowedPortalDomain && domain !== allowedPortalDomain.toLowerCase()) return false;

  const client = parseRestEndpoint(auth.client_endpoint);
  const server = parseRestEndpoint(auth.server_endpoint);
  return client?.hostname.toLowerCase() === domain && server?.hostname === 'oauth.bitrix.info';
}

function parseRestEndpoint(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      url.pathname !== '/rest/'
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
