import { PaginationQueryDto } from '@common/dto/index.js';
import type { PaginatedResponse } from '@common/types/index.js';
import { buildPaginationMeta, Temporal } from '@common/utils/index.js';
import { GameRuleError } from '@common/ws/index.js';

import { Injectable, Logger } from '@nestjs/common';

import { v7 as uuidv7 } from 'uuid';

import { CARO, CARO_END_REASONS, CARO_RESULTS, CARO_SYMBOLS } from '../constants/index.js';
import type { CaroEndReason, CaroSymbol } from '../constants/index.js';
import {
  createBoard,
  findWinningLine,
  isBoardFull,
  otherSymbol,
  placeSymbol,
} from '../engine/caro.engine.js';
import type { CaroMatch } from '../entities/caro-match.entity.js';
import { CARO_MESSAGES } from '../messages/index.js';
import { CaroMatchRepository } from '../repositories/caro-match.repository.js';
import type {
  CaroMatchListItem,
  CaroOutcome,
  CaroPlayer,
  Cell,
  LiveMatch,
  MatchmakingResult,
  MoveResult,
} from '../types/index.js';

const now = (): Date => new Date(Temporal.Now.instant().epochMilliseconds);

/**
 * Matchmaking and live matches. Matches in progress are kept in memory (they only matter while
 * both players are connected); a match is written to the database the moment it ends.
 *
 * Every state change below is synchronous, so two socket events can never interleave inside it:
 * Node runs one of them to completion before the other starts.
 */
@Injectable()
export class CaroMatchService {
  private readonly logger = new Logger(CaroMatchService.name);

  /** The player waiting for an opponent, if any. Random pairing = whoever asks next. */
  private waiting: CaroPlayer | null = null;
  private readonly matches = new Map<string, LiveMatch>();
  /** userId → id of the match the user is playing. */
  private readonly matchOfUser = new Map<string, string>();

  constructor(private readonly matchRepository: CaroMatchRepository) {}

  /**
   * Puts the player in the queue, or pairs them with the waiting player.
   * Who plays X (and therefore moves first) is decided by a coin flip.
   */
  findMatch(player: CaroPlayer, random: () => number = Math.random): MatchmakingResult {
    if (this.matchOfUser.has(player.userId)) {
      throw new GameRuleError(CARO_MESSAGES.ERROR.ALREADY_IN_MATCH);
    }
    if (this.waiting?.userId === player.userId) {
      throw new GameRuleError(CARO_MESSAGES.ERROR.ALREADY_WAITING);
    }
    if (!this.waiting) {
      this.waiting = player;
      return { status: 'waiting' };
    }

    const opponent = this.waiting;
    this.waiting = null;
    const [playerX, playerO] = random() < 0.5 ? [player, opponent] : [opponent, player];
    const match: LiveMatch = {
      id: uuidv7(),
      players: { X: playerX, O: playerO },
      board: createBoard(),
      moves: [],
      turn: CARO_SYMBOLS.X,
      startedAt: now(),
    };
    this.matches.set(match.id, match);
    this.matchOfUser.set(playerX.userId, match.id);
    this.matchOfUser.set(playerO.userId, match.id);

    this.logger.log(`Match started (id=${match.id}, X=${playerX.name}, O=${playerO.name})`);
    return { status: 'matched', match };
  }

  /** Leaves the queue. Returns false when the socket was not the one waiting. */
  cancelSearch(socketId: string): boolean {
    if (this.waiting?.socketId !== socketId) return false;
    this.waiting = null;
    return true;
  }

  async move(userId: string, cell: Cell): Promise<MoveResult> {
    const match = this.findMatchOfUser(userId);
    const symbol = this.symbolOf(match, userId);
    if (match.turn !== symbol) throw new GameRuleError(CARO_MESSAGES.ERROR.NOT_YOUR_TURN);

    placeSymbol(match.board, cell, symbol);
    const move = { ...cell, symbol };
    match.moves.push(move);
    match.turn = otherSymbol(symbol);

    const line = findWinningLine(match.board, cell);
    let outcome: CaroOutcome | null = null;
    if (line) {
      outcome = this.outcomeForWinner(symbol, CARO_END_REASONS.FIVE_IN_ROW, line);
    } else if (isBoardFull(match.moves.length)) {
      outcome = {
        result: CARO_RESULTS.DRAW,
        reason: CARO_END_REASONS.BOARD_FULL,
        winner: null,
        line: [],
      };
    }

    if (outcome) await this.finish(match, outcome);
    return { match, move, outcome };
  }

  /**
   * Ends the match of the player who owns `socketId` in favour of the opponent.
   * Returns null when that socket is not playing (e.g. another tab of the same account closed).
   */
  async forfeit(
    socketId: string,
    reason: CaroEndReason,
  ): Promise<{ match: LiveMatch; outcome: CaroOutcome } | null> {
    const match = [...this.matches.values()].find(
      ({ players }) => players.X.socketId === socketId || players.O.socketId === socketId,
    );
    if (!match) return null;

    const loser: CaroSymbol = match.players.X.socketId === socketId ? 'X' : 'O';
    const outcome = this.outcomeForWinner(otherSymbol(loser), reason, []);
    await this.finish(match, outcome);
    return { match, outcome };
  }

  /** Finished matches of the user, newest first. */
  async findHistory(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<CaroMatchListItem>> {
    const { page, limit } = query;
    const { matches, total } = await this.matchRepository.findPageByPlayer(userId, page, limit);

    return {
      data: matches.map((match) => this.toListItem(match, userId)),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  // ── Private Helpers ──

  private findMatchOfUser(userId: string): LiveMatch {
    const match = this.matches.get(this.matchOfUser.get(userId) ?? '');
    if (!match) throw new GameRuleError(CARO_MESSAGES.ERROR.NOT_IN_MATCH);
    return match;
  }

  private symbolOf(match: LiveMatch, userId: string): CaroSymbol {
    return match.players.X.userId === userId ? CARO_SYMBOLS.X : CARO_SYMBOLS.O;
  }

  private outcomeForWinner(winner: CaroSymbol, reason: CaroEndReason, line: Cell[]): CaroOutcome {
    return {
      result: winner === 'X' ? CARO_RESULTS.X_WIN : CARO_RESULTS.O_WIN,
      reason,
      winner,
      line,
    };
  }

  /** Removes the match from memory first (so no further move is accepted), then stores it. */
  private async finish(match: LiveMatch, outcome: CaroOutcome): Promise<void> {
    this.matches.delete(match.id);
    this.matchOfUser.delete(match.players.X.userId);
    this.matchOfUser.delete(match.players.O.userId);

    await this.matchRepository.create({
      id: match.id,
      playerXId: match.players.X.userId,
      playerOId: match.players.O.userId,
      playerXName: match.players.X.name,
      playerOName: match.players.O.name,
      winnerId: outcome.winner ? match.players[outcome.winner].userId : null,
      result: outcome.result,
      reason: outcome.reason,
      moves: match.moves,
      moveCount: match.moves.length,
      startedAt: match.startedAt,
    });
    this.logger.log(
      `Match ended (id=${match.id}, result=${outcome.result}, reason=${outcome.reason}, moves=${match.moves.length}/${CARO.SIZE * CARO.SIZE})`,
    );
  }

  private toListItem(match: CaroMatch, userId: string): CaroMatchListItem {
    const you: CaroSymbol = match.playerXId === userId ? 'X' : 'O';
    const outcome = match.winnerId === null ? 'draw' : match.winnerId === userId ? 'win' : 'lose';

    return {
      id: match.id,
      playerX: match.playerXName,
      playerO: match.playerOName,
      you,
      outcome,
      result: match.result,
      reason: match.reason,
      moveCount: match.moveCount,
      startedAt: match.startedAt,
      finishedAt: match.createdAt,
    };
  }
}
