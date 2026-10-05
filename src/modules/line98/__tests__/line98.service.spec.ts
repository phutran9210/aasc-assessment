import { GameRuleError } from '@common/ws/index.js';

import { Logger } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { emptyCells } from '../engine/line98.engine.js';
import { Line98Game } from '../entities/line98-game.entity.js';
import { Line98GameRepository } from '../repositories/line98-game.repository.js';
import { Line98Service } from '../services/line98.service.js';
import type { Board } from '../types/index.js';

const USER = 'user-1';
const countBalls = (board: Board): number => 81 - emptyCells(board).length;

/** Uses a real in-memory SQLite database: saving and reloading the board is the point. */
describe('Line98Service', () => {
  let dataSource: DataSource;
  let service: Line98Service;

  const storedGames = (): Promise<Line98Game[]> =>
    dataSource.getRepository(Line98Game).find({ order: { id: 'ASC' } });

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Line98Game],
      synchronize: true,
    });
    await dataSource.initialize();
    service = new Line98Service(new Line98GameRepository(dataSource));
  });

  afterEach(async () => {
    await dataSource.destroy();
    jest.restoreAllMocks();
  });

  describe('getOrCreateGame', () => {
    it('should start and store a game when the player has none', async () => {
      const state = await service.getOrCreateGame(USER);

      expect(state).toEqual({
        id: expect.any(String),
        board: expect.any(Array),
        nextColors: expect.any(Array),
        score: 0,
        moveCount: 0,
        status: 'playing',
      });
      expect(countBalls(state.board)).toBe(5);
      expect(await storedGames()).toHaveLength(1);
    });

    it('should return the same game when called again (resume after reconnect)', async () => {
      const first = await service.getOrCreateGame(USER);

      const second = await service.getOrCreateGame(USER);

      expect(second).toEqual(first);
      expect(await storedGames()).toHaveLength(1);
    });

    it('should create only one game when two tabs join at the same time', async () => {
      const [a, b] = await Promise.all([
        service.getOrCreateGame(USER),
        service.getOrCreateGame(USER),
      ]);

      expect(a.id).toBe(b.id);
      expect(await storedGames()).toHaveLength(1);
    });

    it('should keep the games of different players separate', async () => {
      const mine = await service.getOrCreateGame(USER);
      const theirs = await service.getOrCreateGame('user-2');

      expect(theirs.id).not.toBe(mine.id);
    });
  });

  describe('newGame', () => {
    it('should abandon the current game and start another', async () => {
      const first = await service.getOrCreateGame(USER);

      const second = await service.newGame(USER);

      expect(second.id).not.toBe(first.id);
      expect((await service.getOrCreateGame(USER)).id).toBe(second.id);
      expect((await storedGames()).map((game) => game.status).sort()).toEqual([
        'abandoned',
        'playing',
      ]);
    });
  });

  describe('move', () => {
    it('should apply the hinted move and persist the new board', async () => {
      await service.getOrCreateGame(USER);
      const hint = await service.hint(USER);

      const result = await service.move(USER, hint.from, hint.to);

      expect(result.path[0]).toEqual(hint.from);
      expect(result.path.at(-1)).toEqual(hint.to);
      expect(result.state.moveCount).toBe(1);
      expect(countBalls(result.state.board)).toBe(8);
      expect(result.spawned).toHaveLength(3);
      // Reloading from the database gives exactly the state the player saw.
      expect(await service.getOrCreateGame(USER)).toEqual(result.state);
    });

    it('should reject an illegal move and leave the stored game untouched', async () => {
      const before = await service.getOrCreateGame(USER);
      const [emptyA, emptyB] = emptyCells(before.board);

      await expect(service.move(USER, emptyA, emptyB)).rejects.toThrow(
        new GameRuleError('Ô được chọn không có bóng'),
      );
      expect(await service.getOrCreateGame(USER)).toEqual(before);
    });

    it('should apply simultaneous moves one after another without losing one', async () => {
      await service.getOrCreateGame(USER);
      const hint = await service.hint(USER);

      const results = await Promise.allSettled([
        service.move(USER, hint.from, hint.to),
        service.move(USER, hint.from, hint.to),
      ]);

      // The second request sees the board after the first: its origin is now empty.
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
      expect((await service.getOrCreateGame(USER)).moveCount).toBe(1);
    });

    it('should mark the game over when the board fills up, then refuse further moves', async () => {
      await service.getOrCreateGame(USER);
      const repository = dataSource.getRepository(Line98Game);
      const [game] = await storedGames();
      // Full board of alternating colours except two cells: one move fills it.
      const board = Array.from({ length: 9 }, () => [1, 2, 1, 2, 1, 2, 1, 2, 1]);
      board[8][8] = 0;
      board[8][7] = 3;
      await repository.update(game.id, { board, nextColors: [4, 5, 4] });

      const result = await service.move(USER, { row: 8, col: 7 }, { row: 8, col: 8 });

      expect(result.state.status).toBe('over');
      await expect(service.move(USER, { row: 0, col: 0 }, { row: 0, col: 1 })).rejects.toThrow(
        new GameRuleError('Ván chơi đã kết thúc, hãy bắt đầu ván mới'),
      );
      // Joining again starts a fresh game instead of resuming the finished one.
      expect((await service.getOrCreateGame(USER)).id).not.toBe(game.id);
    });
  });

  describe('hint', () => {
    it('should throw GameRuleError when the player has no game in progress', async () => {
      await expect(service.hint('nobody')).rejects.toThrow(GameRuleError);
    });
  });
});
