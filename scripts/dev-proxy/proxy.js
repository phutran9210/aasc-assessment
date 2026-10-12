#!/usr/bin/env node
import http from 'node:http';
import { pathToFileURL } from 'node:url';

/**
 * Development helper: one public address for both applications of this repository. A tunnel such
 * as ngrok exposes one local port; this proxy listens there and forwards by path, so Bitrix24 can
 * reach the lead events of the AASC app and the deal events of the TikTok app on the same domain.
 *
 *   /webhooks/*, /api/v1/*  -> TikTok app (default 127.0.0.1:3001)
 *   everything else         -> AASC app   (default 127.0.0.1:3000)
 *
 * /install, /health and /docs exist in both applications; here they belong to the AASC app, so
 * the TikTok app has to reach Bitrix24 through an incoming webhook, not the OAuth installation.
 */
const TIKTOK_PREFIXES = ['/webhooks/', '/api/v1/'];

export function targetFor(path, targets) {
  return TIKTOK_PREFIXES.some((prefix) => path.startsWith(prefix)) ? targets.tiktok : targets.aasc;
}

export function createProxy(targets) {
  const server = http.createServer((request, response) => {
    const target = targetFor(request.url ?? '/', targets);
    const upstream = http.request(
      {
        host: target.host,
        port: target.port,
        method: request.method,
        path: request.url,
        headers: request.headers,
      },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(response);
      },
    );
    upstream.once('error', () => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' });
      response.end(`Upstream ${target.host}:${target.port} is not reachable`);
    });
    request.pipe(upstream);
  });

  // Socket.IO of the game modules: forward the upgrade handshake as raw bytes.
  server.on('upgrade', (request, socket, head) => {
    const target = targetFor(request.url ?? '/', targets);
    const upstream = http.request({
      host: target.host,
      port: target.port,
      method: request.method,
      path: request.url,
      headers: request.headers,
    });
    upstream.once('upgrade', (answer, upstreamSocket, upstreamHead) => {
      const headers = Object.entries(answer.headers)
        .flatMap(([name, value]) =>
          (Array.isArray(value) ? value : [value]).map((item) => `${name}: ${item}`),
        )
        .join('\r\n');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n\r\n`);
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
      upstreamSocket.once('error', () => socket.destroy());
      socket.once('error', () => upstreamSocket.destroy());
    });
    upstream.once('error', () => socket.destroy());
    upstream.end();
  });

  return server;
}

function port(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be a port number`);
  }
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const targets = {
    aasc: { host: '127.0.0.1', port: port('AASC_PORT', 3000) },
    tiktok: { host: '127.0.0.1', port: port('TIKTOK_PORT', 3001) },
  };
  const listenPort = port('PROXY_PORT', 8080);
  createProxy(targets).listen(listenPort, '127.0.0.1', () => {
    console.log(`Proxy on http://127.0.0.1:${listenPort}`);
    console.log(`  /webhooks/*, /api/v1/* -> TikTok app on :${targets.tiktok.port}`);
    console.log(`  everything else        -> AASC app on :${targets.aasc.port}`);
  });
}
