import type { DefaultEventsMap, Socket } from 'socket.io';

import type { AuthService } from '../services/auth.service.js';
import type { AuthUser } from '../types/index.js';

/** A socket that passed the handshake: `data.user` is always set inside gateway handlers. */
export type AuthenticatedSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  { user: AuthUser }
>;

type SocketMiddleware = (socket: Socket, next: (error?: Error) => void) => void;

/**
 * Socket.IO handshake middleware: the client connects with `io(url, { auth: { token } })`.
 * A missing or invalid token refuses the connection (`connect_error` on the client), so no
 * gateway handler ever runs for an anonymous socket.
 */
export function createWsAuthMiddleware(authService: AuthService): SocketMiddleware {
  return (socket, next) => {
    const { token } = socket.handshake.auth as { token?: unknown };

    authService
      .verifyToken(typeof token === 'string' ? token : undefined)
      .then((user) => {
        (socket.data as { user: AuthUser }).user = user;
        next();
      })
      .catch((error: unknown) => {
        next(error instanceof Error ? error : new Error(String(error)));
      });
  };
}
