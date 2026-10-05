import { toAck } from '@common/ws/index.js';
import type { WsAck } from '@common/ws/index.js';
import { AuthService } from '@modules/auth/services/auth.service.js';
import { createWsAuthMiddleware } from '@modules/auth/ws/ws-auth.middleware.js';
import type { AuthenticatedSocket } from '@modules/auth/ws/ws-auth.middleware.js';

import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { OnGatewayConnection, OnGatewayInit } from '@nestjs/websockets';

import type { Namespace } from 'socket.io';

import { LINE98_WS } from '../constants/index.js';
import { parseCell } from '../engine/line98.engine.js';
import { Line98Service } from '../services/line98.service.js';
import type { Line98Hint, Line98MoveResult, Line98State } from '../types/index.js';

/** One room per player: every tab of the same account sees the same board. */
const roomOf = (userId: string): string => `user:${userId}`;

/**
 * Real-time API of Line 98 (Socket.IO namespace `/line98`).
 * Every client event is answered through its acknowledgement callback with a `WsAck`;
 * board changes are also broadcast as `game:state` to the player's other tabs.
 */
@WebSocketGateway({ namespace: LINE98_WS.NAMESPACE, cors: { origin: true } })
export class Line98Gateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  private readonly server: Namespace;

  constructor(
    private readonly line98Service: Line98Service,
    private readonly authService: AuthService,
  ) {}

  afterInit(server: Namespace): void {
    server.use(createWsAuthMiddleware(this.authService));
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    await client.join(roomOf(client.data.user.id));
  }

  @SubscribeMessage(LINE98_WS.JOIN)
  join(@ConnectedSocket() client: AuthenticatedSocket): Promise<WsAck<Line98State>> {
    return toAck(() => this.line98Service.getOrCreateGame(client.data.user.id));
  }

  @SubscribeMessage(LINE98_WS.NEW)
  newGame(@ConnectedSocket() client: AuthenticatedSocket): Promise<WsAck<Line98State>> {
    return toAck(async () => {
      const state = await this.line98Service.newGame(client.data.user.id);
      this.broadcast(client, { state, path: [], cleared: [], spawned: [] });
      return state;
    });
  }

  @SubscribeMessage(LINE98_WS.MOVE)
  move(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: unknown,
  ): Promise<WsAck<Line98MoveResult>> {
    return toAck(async () => {
      const { from, to } = (body ?? {}) as { from?: unknown; to?: unknown };
      const result = await this.line98Service.move(
        client.data.user.id,
        parseCell(from),
        parseCell(to),
      );
      this.broadcast(client, result);
      return result;
    });
  }

  @SubscribeMessage(LINE98_WS.HINT)
  hint(@ConnectedSocket() client: AuthenticatedSocket): Promise<WsAck<Line98Hint>> {
    return toAck(() => this.line98Service.hint(client.data.user.id));
  }

  /** Sends the change to the player's other sockets; the sender already has it in the ack. */
  private broadcast(sender: AuthenticatedSocket, result: Line98MoveResult): void {
    sender.to(roomOf(sender.data.user.id)).emit(LINE98_WS.STATE, result);
  }
}
