import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';

import { createProxy, targetFor } from './proxy.js';

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function upstream(name) {
  return http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      response.writeHead(name === 'tiktok' && request.url === '/api/v1/missing' ? 404 : 200, {
        'content-type': 'application/json',
      });
      response.end(JSON.stringify({ app: name, method: request.method, path: request.url, body }));
    });
  });
}

describe('dev proxy', () => {
  const aasc = upstream('aasc');
  const tiktok = upstream('tiktok');
  let proxy;
  let base;

  before(async () => {
    const targets = {
      aasc: { host: '127.0.0.1', port: await listen(aasc) },
      tiktok: { host: '127.0.0.1', port: await listen(tiktok) },
    };
    proxy = createProxy(targets);
    base = `http://127.0.0.1:${await listen(proxy)}`;
  });

  after(() => {
    for (const server of [proxy, aasc, tiktok]) server.close();
  });

  it('sends webhook and versioned API paths to the TikTok app', async () => {
    const deal = await fetch(`${base}/webhooks/bitrix24/deals`, {
      method: 'POST',
      body: 'event=x',
    });
    assert.deepEqual(await deal.json(), {
      app: 'tiktok',
      method: 'POST',
      path: '/webhooks/bitrix24/deals',
      body: 'event=x',
    });

    const leads = await fetch(`${base}/api/v1/leads?page=1`);
    assert.equal((await leads.json()).path, '/api/v1/leads?page=1');
  });

  it('sends every other path to the AASC app', async () => {
    for (const path of ['/lead-sync/bitrix-events', '/install', '/health', '/']) {
      const response = await fetch(`${base}${path}`, { method: 'POST', body: 'x' });
      assert.equal((await response.json()).app, 'aasc', path);
    }
  });

  it('passes the upstream status through', async () => {
    const response = await fetch(`${base}/api/v1/missing`);
    assert.equal(response.status, 404);
  });

  it('answers 502 when the upstream is down', async () => {
    const dead = createProxy({
      aasc: { host: '127.0.0.1', port: 1 },
      tiktok: { host: '127.0.0.1', port: 1 },
    });
    const port = await listen(dead);
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 502);
    dead.close();
  });

  it('does not treat a look-alike prefix as a TikTok path', () => {
    const targets = { aasc: 'aasc', tiktok: 'tiktok' };
    assert.equal(targetFor('/webhooks-admin', targets), 'aasc');
    assert.equal(targetFor('/api/v10/x', targets), 'aasc');
    assert.equal(targetFor('/webhooks/tiktok/leads', targets), 'tiktok');
  });
});
