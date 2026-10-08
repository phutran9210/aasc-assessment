import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import type { FeedbackEvent } from '../ports/tiktok-feedback-provider.port.js';
import type { EventResult } from '../ports/tiktok-feedback-provider.port.js';
import type { SpendPage } from '../ports/campaign-spend-provider.port.js';
import type { ProviderLead } from '../ports/tiktok-lead-provider.port.js';
import type { ProviderFault } from './bitrix-store.js';
import type { BitrixStore } from './bitrix-store.js';
import type { TiktokFault } from './tiktok-store.js';
import type { TiktokStore } from './tiktok-store.js';

const MAX_BODY_BYTES = 1024 * 1024;

export type ProviderServerOptions = {
  bitrix: BitrixStore;
  tiktok: TiktokStore;
  exposeControl?: boolean;
  tiktokApiKey?: string;
};

export class ProviderServer {
  private readonly server: Server;
  private readonly tiktokApiKey: string;
  private origin: string | undefined;

  constructor(private readonly options: ProviderServerOptions) {
    this.tiktokApiKey = options.tiktokApiKey ?? 'mock-api-key';
    this.server = createServer((request, response) => void this.handle(request, response));
  }

  get bitrixEndpoint(): string {
    if (!this.origin) throw new Error('ProviderServer is not listening');
    return `${this.origin}/rest/1/mock/`;
  }

  get tiktokBaseUrl(): string {
    if (!this.origin) throw new Error('ProviderServer is not listening');
    return `${this.origin}/tiktok`;
  }

  async listen(port = 0): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '127.0.0.1', () => {
        this.server.off('error', reject);
        const address = this.server.address();
        if (!address || typeof address === 'string') return reject(new Error('No TCP address'));
        this.origin = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? '/', this.origin ?? 'http://127.0.0.1');
      if (url.pathname.startsWith('/rest/')) {
        await this.handleBitrix(request, response, url.pathname);
        return;
      }
      if (url.pathname.startsWith('/tiktok/')) {
        await this.handleTiktok(request, response, url);
        return;
      }
      if (this.options.exposeControl && url.pathname.startsWith('/__control/')) {
        await this.handleControl(request, response, url);
        return;
      }
      this.send(response, 404, { code: 'NOT_FOUND' });
    } catch (error) {
      this.send(response, 400, {
        code: 'INVALID_REQUEST',
        message: error instanceof Error ? error.message : 'Invalid request',
      });
    }
  }

  private async handleControl(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    if (request.method === 'GET' && url.pathname === '/__control/health') {
      this.send(response, 200, { status: 'ok' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/__control/calls') {
      const calls =
        url.searchParams.get('provider') === 'tiktok'
          ? this.options.tiktok.calls
          : this.options.bitrix.calls;
      this.send(response, 200, { calls });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/__control/tiktok/leads') {
      const body = await this.readJson(request);
      if (
        typeof body.id !== 'string' ||
        typeof body.advertiserId !== 'string' ||
        !isRecord(body.fields)
      ) {
        return this.send(response, 400, { code: 'LEAD_INVALID' });
      }
      this.options.tiktok.setLead(body as ProviderLead);
      this.send(response, 200, { accepted: true });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/__control/tiktok/spend') {
      const body = await this.readJson(request);
      if (!Array.isArray(body.pages)) return this.send(response, 400, { code: 'SPEND_INVALID' });
      this.options.tiktok.setSpendPages(body.pages as SpendPage[]);
      this.send(response, 200, { accepted: true });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/__control/tiktok/feedback-result') {
      const body = await this.readJson(request);
      if (!Array.isArray(body.results))
        return this.send(response, 400, { code: 'FEEDBACK_INVALID' });
      this.options.tiktok.setNextFeedbackResult(body.results as EventResult[]);
      this.send(response, 200, { accepted: true });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/__control/bitrix/fault') {
      const body = await this.readJson(request);
      const method = typeof body.method === 'string' ? body.method : '';
      const fault = body.fault;
      if (!method || !isBitrixFault(fault))
        return this.send(response, 400, { code: 'FAULT_INVALID' });
      this.options.bitrix.injectFault(method, fault);
      this.send(response, 200, { accepted: true });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/__control/tiktok/fault') {
      const body = await this.readJson(request);
      const method = body.method;
      const fault = body.fault;
      if (
        (method !== 'lead' && method !== 'spend' && method !== 'feedback') ||
        !isTiktokFault(fault)
      ) {
        return this.send(response, 400, { code: 'FAULT_INVALID' });
      }
      this.options.tiktok.injectFault(method, fault);
      this.send(response, 200, { accepted: true });
      return;
    }
    this.send(response, 404, { code: 'NOT_FOUND' });
  }

  private async handleBitrix(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<void> {
    if (request.method !== 'POST') return this.send(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    const method = pathname.slice(pathname.lastIndexOf('/') + 1);
    const body = await this.readJson(request);
    const result = this.options.bitrix.execute(method, body);
    if (result.hang) {
      request.socket.setTimeout(500, () => request.socket.destroy());
      return;
    }
    this.send(response, result.status, result.body);
  }

  private async handleTiktok(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    const authorization = request.headers.authorization;
    if (authorization !== `Bearer ${this.tiktokApiKey}`) {
      this.send(response, 401, { code: 'AUTH_INVALID' });
      return;
    }
    const [, , resource, id] = url.pathname.split('/');
    if (request.method === 'GET' && resource === 'leads') {
      this.sendTiktok(
        response,
        this.options.tiktok.execute('lead', { id: decodeURIComponent(id ?? '') }),
      );
      return;
    }
    if (request.method === 'GET' && resource === 'spend') {
      this.sendTiktok(
        response,
        this.options.tiktok.execute('spend', {
          cursor: url.searchParams.get('cursor') ?? undefined,
        }),
      );
      return;
    }
    if (request.method === 'POST' && resource === 'events') {
      const body = await this.readJson(request);
      const events = Array.isArray(body.events) ? (body.events as FeedbackEvent[]) : [];
      this.sendTiktok(response, this.options.tiktok.execute('feedback', { events }));
      return;
    }
    this.send(response, 404, { code: 'NOT_FOUND' });
  }

  private async readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of request as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) throw new RangeError('Request body is too large');
      chunks.push(chunk);
    }
    if (size === 0) return {};
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new TypeError('JSON body must be an object');
    return value as Record<string, unknown>;
  }

  private sendTiktok(
    response: ServerResponse,
    result: { status: number; body: unknown; hang?: boolean },
  ): void {
    if (result.hang) return;
    this.send(response, result.status, result.body);
  }

  private send(response: ServerResponse, status: number, body: unknown): void {
    if (response.destroyed || response.writableEnded) return;
    const encoded = JSON.stringify(body);
    response.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(encoded),
    });
    response.end(encoded);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isBitrixFault(value: unknown): value is ProviderFault {
  return (
    value === 'persist_then_timeout' ||
    value === 'timeout_without_persist' ||
    value === 'rate_limit' ||
    value === 'auth_invalid' ||
    value === 'stale_snapshot'
  );
}

function isTiktokFault(value: unknown): value is TiktokFault {
  return (
    value === 'rate_limit' ||
    value === 'auth_invalid' ||
    value === 'partial_feedback' ||
    value === 'timeout_without_persist'
  );
}
