import type { NestExpressApplication } from '@nestjs/platform-express';

import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import request from 'supertest';

export type Ack<T> = { ok: true; data: T } | { ok: false; message: string };

/** Registers a user and returns its access token. */
export async function registerAndLogin(
  app: NestExpressApplication,
  username: string,
): Promise<string> {
  const credentials = { username, password: 'matkhau123' };
  await request(app.getHttpServer()).post('/auth/register').send(credentials).expect(201);
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .send(credentials)
    .expect(200);
  return response.body.accessToken as string;
}

/** Opens an authenticated Socket.IO connection and waits until it is established. */
export function connectSocket(url: string, namespace: string, token?: string): Promise<Socket> {
  const socket = io(`${url}${namespace}`, {
    auth: token ? { token } : {},
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });

  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => {
      socket.close();
      reject(error);
    });
  });
}

/** Emits an event and resolves with the server's acknowledgement. */
export function emitAck<T>(socket: Socket, event: string, body?: unknown): Promise<Ack<T>> {
  return socket.timeout(5000).emitWithAck(event, body) as Promise<Ack<T>>;
}

/** Resolves with the payload of the next `event` received by the socket. */
export function nextEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}
