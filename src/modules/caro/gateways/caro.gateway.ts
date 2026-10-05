import { toAck } from '@common/ws/index.js';
import type { WsAck } from '@common/ws/index.js';
import { AuthService } from '@modules/auth/services/auth.service.js';
import { createWsAuthMiddleware } from '@modules/auth/ws/ws-auth.middleware.js';
import type { AuthenticatedSocket } from '@modules/auth/ws/ws-auth.middleware.js';
import { UserService } from '@modules/user/services/user.service.js';

import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';

import type { Namespace } from 'socket.io';

import { CARO, CARO_END_REASONS, CARO_SYMBOLS, CARO_WS } from '../constants/index.js';
import type { CaroEndReason } from '../constants/index.js';
import { parseCell } from '../engine/caro.engine.js';
import { CaroMatchService } from '../services/caro-match.service.js';
import type {
  CaroOutcome,
  LiveMatch,
  MatchEndPayload,
  MatchStartPayload,
  MatchUpdatePayload,
} from '../types/index.js';

const roomOf = (matchId: string): string => `match:${matchId}`;

/**
 * Real-time API of Caro (Socket.IO namespace `/caro`).
 * Requests are answered through acknowledgements (`WsAck`); what both players must see
 * (`match:start`, `match:update`, `match:end`) is broadcast to the match room.
 */
@WebSocketGateway({ namespace: CARO_WS.NAMESPACE, cors: { origin: true } })
export class CaroGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server: Namespace;

  constructor(
    private readonly matchService: CaroMatchService,
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  afterInit(server: Namespace): void {
    server.use(createWsAuthMiddleware(this.authService));
  }

  /** A dropped connection leaves the queue, or loses the match being played. */
  async handleDisconnect(client: AuthenticatedSocket): Promise<void> {
    this.matchService.cancelSearch(client.id);
    await this.endByForfeit(client.id, CARO_END_REASONS.DISCONNECT);
  }

  @SubscribeMessage(CARO_WS.FIND)
  find(
    @ConnectedSocket() client: AuthenticatedSocket,
  ): Promise<WsAck<{ status: 'waiting' | 'matched' }>> {
    return toAck(async () => {
      const { id: userId, username } = client.data.user;
      const { nickname } = await this.userService.getProfile(userId);

      const result = this.matchService.findMatch({
        userId,
        name: nickname ?? username,
        socketId: client.id,
      });
      if (result.status === 'matched') this.startMatch(result.match);
      return { status: result.status };
    });
  }

  @SubscribeMessage(CARO_WS.CANCEL)
  cancel(@ConnectedSocket() client: AuthenticatedSocket): Promise<WsAck<{ cancelled: boolean }>> {
    return toAck(() => ({ cancelled: this.matchService.cancelSearch(client.id) }));
  }

  @SubscribeMessage(CARO_WS.MOVE)
  move(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: unknown,
  ): Promise<WsAck<MatchUpdatePayload>> {
    return toAck(async () => {
      const { match, move, outcome } = await this.matchService.move(
        client.data.user.id,
        parseCell(body),
      );

      const update: MatchUpdatePayload = { matchId: match.id, move, turn: match.turn };
      this.server.to(roomOf(match.id)).emit(CARO_WS.UPDATE, update);
      if (outcome) this.endMatch(match, outcome);
      return update;
    });
  }

  @SubscribeMessage(CARO_WS.LEAVE)
  leave(@ConnectedSocket() client: AuthenticatedSocket): Promise<WsAck<{ left: boolean }>> {
    return toAck(async () => ({
      left: await this.endByForfeit(client.id, CARO_END_REASONS.RESIGN),
    }));
  }

  // ── Private Helpers ──

  /** Puts both sockets in the match room and tells each player which symbol they play. */
  private startMatch(match: LiveMatch): void {
    for (const symbol of [CARO_SYMBOLS.X, CARO_SYMBOLS.O]) {
      const player = match.players[symbol];
      const opponent = match.players[symbol === 'X' ? 'O' : 'X'];
      const payload: MatchStartPayload = {
        matchId: match.id,
        you: symbol,
        opponent: opponent.name,
        size: CARO.SIZE,
        turn: match.turn,
      };

      this.server.in(player.socketId).socketsJoin(roomOf(match.id));
      this.server.to(player.socketId).emit(CARO_WS.START, payload);
    }
  }

  private endMatch(match: LiveMatch, outcome: CaroOutcome): void {
    const payload: MatchEndPayload = { matchId: match.id, ...outcome };
    this.server.to(roomOf(match.id)).emit(CARO_WS.END, payload);
    this.server.in(roomOf(match.id)).socketsLeave(roomOf(match.id));
  }

  private async endByForfeit(socketId: string, reason: CaroEndReason): Promise<boolean> {
    const ended = await this.matchService.forfeit(socketId, reason);
    if (ended) this.endMatch(ended.match, ended.outcome);
    return ended !== null;
  }
}
