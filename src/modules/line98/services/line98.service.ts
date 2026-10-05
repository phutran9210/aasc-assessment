import { GameRuleError, KeyedMutex } from '@common/ws/index.js';

import { Injectable, Logger } from '@nestjs/common';

import { LINE98_STATUSES } from '../constants/index.js';
import { applyMove, createGame, pickHint } from '../engine/line98.engine.js';
import type { Line98Game } from '../entities/line98-game.entity.js';
import { LINE98_MESSAGES } from '../messages/index.js';
import { Line98GameRepository } from '../repositories/line98-game.repository.js';
import type { Cell, Line98Hint, Line98MoveResult, Line98State } from '../types/index.js';

/**
 * Connects the pure rules (engine) to storage. The server owns the game: the client only sends
 * intentions (move from A to B) and receives the resulting state.
 */
@Injectable()
export class Line98Service {
  private readonly logger = new Logger(Line98Service.name);
  /** A player's requests are applied one at a time, even when sent from several tabs at once. */
  private readonly mutex = new KeyedMutex();

  constructor(private readonly gameRepository: Line98GameRepository) {}

  /** Resumes the unfinished game of the player, or starts one if there is none. */
  getOrCreateGame(userId: string): Promise<Line98State> {
    return this.mutex.run(userId, async () => {
      const game =
        (await this.gameRepository.findActiveByUser(userId)) ?? (await this.start(userId));
      return this.toState(game);
    });
  }

  /** Abandons the current game and starts a fresh one. */
  newGame(userId: string): Promise<Line98State> {
    return this.mutex.run(userId, async () => {
      await this.gameRepository.abandonActiveByUser(userId);
      return this.toState(await this.start(userId));
    });
  }

  move(userId: string, from: Cell, to: Cell): Promise<Line98MoveResult> {
    return this.mutex.run(userId, async () => {
      const game = await this.findActiveOrFail(userId);
      const result = applyMove(game, from, to);

      game.board = result.board;
      game.nextColors = result.nextColors;
      game.score = result.score;
      game.moveCount += 1;
      if (result.isOver) {
        game.status = LINE98_STATUSES.OVER;
        this.logger.log(`Game over (id=${game.id}, score=${game.score}, moves=${game.moveCount})`);
      }
      const saved = await this.gameRepository.save(game);

      return {
        state: this.toState(saved),
        path: result.path,
        cleared: result.cleared,
        spawned: result.spawned,
      };
    });
  }

  /** A random legal move for the current board. */
  hint(userId: string): Promise<Line98Hint> {
    return this.mutex.run(userId, async () => {
      const game = await this.findActiveOrFail(userId);
      const hint = pickHint(game.board);
      if (!hint) throw new GameRuleError(LINE98_MESSAGES.ERROR.NO_HINT);
      return hint;
    });
  }

  // ── Private Helpers ──

  private start(userId: string): Promise<Line98Game> {
    return this.gameRepository.create({
      userId,
      ...createGame(),
      moveCount: 0,
      status: LINE98_STATUSES.PLAYING,
    });
  }

  private async findActiveOrFail(userId: string): Promise<Line98Game> {
    const game = await this.gameRepository.findActiveByUser(userId);
    if (!game) throw new GameRuleError(LINE98_MESSAGES.ERROR.GAME_OVER);
    return game;
  }

  private toState(game: Line98Game): Line98State {
    return {
      id: game.id,
      board: game.board,
      nextColors: game.nextColors,
      score: game.score,
      moveCount: game.moveCount,
      status: game.status,
    };
  }
}
