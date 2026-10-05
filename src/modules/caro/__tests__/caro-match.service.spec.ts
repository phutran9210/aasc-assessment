import { GameRuleError } from '@common/ws/index.js';

import { Logger } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { CaroMatch } from '../entities/caro-match.entity.js';
import { CaroMatchRepository } from '../repositories/caro-match.repository.js';
import { CaroMatchService } from '../services/caro-match.service.js';
import type { CaroPlayer, Cell, LiveMatch } from '../types/index.js';

const player = (name: string): CaroPlayer => ({
  userId: `user-${name}`,
  name,
  socketId: `socket-${name}`,
});
const alice = player('alice');
const bob = player('bob');
const cell = (row: number, col: number): Cell => ({ row, col });

/** Makes the second player to arrive play X (random() >= 0.5 keeps the waiting player as X). */
const WAITING_PLAYER_IS_X = () => 0.9;

/** Uses a real in-memory SQLite database: storing the finished match is part of the behaviour. */
describe('CaroMatchService', () => {
  let dataSource: DataSource;
  let service: CaroMatchService;

  const storedMatches = (): Promise<CaroMatch[]> => dataSource.getRepository(CaroMatch).find();

  /** alice (X) and bob (O) in a started match. */
  function startMatch(): LiveMatch {
    service.findMatch(alice, WAITING_PLAYER_IS_X);
    const result = service.findMatch(bob, WAITING_PLAYER_IS_X);
    if (result.status !== 'matched') throw new Error('expected a match');
    return result.match;
  }

  /** X plays row 0, O plays row 1, until X has `count` in a row. */
  async function playUntilXHas(count: number): Promise<void> {
    for (let col = 0; col < count; col += 1) {
      await service.move(alice.userId, cell(0, col));
      if (col < count - 1) await service.move(bob.userId, cell(1, col));
    }
  }

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [CaroMatch],
      synchronize: true,
    });
    await dataSource.initialize();
    service = new CaroMatchService(new CaroMatchRepository(dataSource));
  });

  afterEach(async () => {
    await dataSource.destroy();
    jest.restoreAllMocks();
  });

  describe('findMatch', () => {
    it('should make the first player wait', () => {
      expect(service.findMatch(alice)).toEqual({ status: 'waiting' });
    });

    it('should pair the second player with the waiting one on an empty board, X to move', () => {
      const match = startMatch();

      expect(match.players).toEqual({ X: alice, O: bob });
      expect(match.turn).toBe('X');
      expect(match.moves).toEqual([]);
      expect(match.board.flat().every((value) => value === null)).toBe(true);
    });

    it('should decide who plays X by the coin flip', () => {
      service.findMatch(alice);

      const result = service.findMatch(bob, () => 0.1);

      expect(result.status === 'matched' && result.match.players).toEqual({ X: bob, O: alice });
    });

    it('should pair players two by two when many are searching', () => {
      const statuses = ['a', 'b', 'c', 'd', 'e'].map(
        (name) => service.findMatch(player(name)).status,
      );

      expect(statuses).toEqual(['waiting', 'matched', 'waiting', 'matched', 'waiting']);
    });

    it('should refuse a player who is already waiting, even from another socket', () => {
      service.findMatch(alice);

      expect(() => service.findMatch({ ...alice, socketId: 'other-tab' })).toThrow(
        new GameRuleError('Bạn đang trong hàng chờ ghép cặp'),
      );
    });

    it('should refuse a player who is already in a match', () => {
      startMatch();

      expect(() => service.findMatch(alice)).toThrow(
        new GameRuleError('Bạn đang trong một trận đấu'),
      );
    });
  });

  describe('cancelSearch', () => {
    it('should remove the waiting player so the next one waits instead of matching', () => {
      service.findMatch(alice);

      expect(service.cancelSearch(alice.socketId)).toBe(true);
      expect(service.findMatch(bob)).toEqual({ status: 'waiting' });
    });

    it('should do nothing when the socket is not the one waiting', () => {
      service.findMatch(alice);

      expect(service.cancelSearch('someone-else')).toBe(false);
      expect(service.findMatch(bob).status).toBe('matched');
    });
  });

  describe('move', () => {
    it('should place the symbol and pass the turn', async () => {
      startMatch();

      const result = await service.move(alice.userId, cell(7, 7));

      expect(result.move).toEqual({ row: 7, col: 7, symbol: 'X' });
      expect(result.match.board[7][7]).toBe('X');
      expect(result.match.turn).toBe('O');
      expect(result.outcome).toBeNull();
    });

    it('should reject a move out of turn and leave the board unchanged', async () => {
      const match = startMatch();

      await expect(service.move(bob.userId, cell(7, 7))).rejects.toThrow(
        new GameRuleError('Chưa đến lượt của bạn'),
      );
      expect(match.board[7][7]).toBeNull();
      expect(match.turn).toBe('X');
    });

    it('should reject an occupied cell and keep the turn', async () => {
      const match = startMatch();
      await service.move(alice.userId, cell(7, 7));

      await expect(service.move(bob.userId, cell(7, 7))).rejects.toThrow(
        new GameRuleError('Ô này đã được đánh'),
      );
      expect(match.turn).toBe('O');
      expect(match.moves).toHaveLength(1);
    });

    it('should reject a player who is not in any match', async () => {
      await expect(service.move('stranger', cell(0, 0))).rejects.toThrow(
        new GameRuleError('Bạn không ở trong trận đấu nào'),
      );
    });

    it('should declare the winner and store the match when five in a row is made', async () => {
      startMatch();
      await playUntilXHas(4);
      await service.move(bob.userId, cell(1, 3));

      const result = await service.move(alice.userId, cell(0, 4));

      expect(result.outcome).toEqual({
        result: 'x_win',
        reason: 'five_in_row',
        winner: 'X',
        line: [0, 1, 2, 3, 4].map((col) => cell(0, col)),
      });
      const [stored] = await storedMatches();
      expect(stored).toEqual(
        expect.objectContaining({
          playerXId: alice.userId,
          playerOId: bob.userId,
          playerXName: 'alice',
          playerOName: 'bob',
          winnerId: alice.userId,
          result: 'x_win',
          reason: 'five_in_row',
          moveCount: 9,
        }),
      );
      expect(stored.moves).toHaveLength(9);
      expect(stored.moves[0]).toEqual({ row: 0, col: 0, symbol: 'X' });
      expect(stored.startedAt).toBeInstanceOf(Date);
    });

    it('should accept no more moves and free both players once the match is over', async () => {
      startMatch();
      await playUntilXHas(5);

      await expect(service.move(bob.userId, cell(5, 5))).rejects.toThrow(
        new GameRuleError('Bạn không ở trong trận đấu nào'),
      );
      expect(service.findMatch(alice)).toEqual({ status: 'waiting' });
      expect(service.findMatch(bob).status).toBe('matched');
    });
  });

  describe('forfeit', () => {
    it.each([
      ['resign', alice, 'o_win', bob],
      ['disconnect', bob, 'x_win', alice],
    ] as const)(
      'should give the win to the opponent and store the match on %s',
      async (reason, quitter, result, winner) => {
        startMatch();
        await service.move(alice.userId, cell(7, 7));

        const ended = await service.forfeit(quitter.socketId, reason);

        expect(ended?.outcome).toEqual({
          result,
          reason,
          winner: result === 'x_win' ? 'X' : 'O',
          line: [],
        });
        expect(await storedMatches()).toEqual([
          expect.objectContaining({ winnerId: winner.userId, reason, moveCount: 1 }),
        ]);
      },
    );

    it('should return null and store nothing when the socket is not playing', async () => {
      startMatch();

      expect(await service.forfeit('another-tab-of-alice', 'disconnect')).toBeNull();
      expect(await storedMatches()).toEqual([]);
    });
  });

  describe('findHistory', () => {
    it('should list the matches of the player, newest first, from their point of view', async () => {
      startMatch();
      await playUntilXHas(5);
      startMatch();
      await service.forfeit(alice.socketId, 'resign');

      const mine = await service.findHistory(alice.userId, { page: 1, limit: 20 });
      const theirs = await service.findHistory(bob.userId, { page: 1, limit: 20 });

      expect(mine.meta).toEqual({ total: 2, page: 1, limit: 20, totalPages: 1 });
      expect(mine.data.map((match) => [match.you, match.outcome, match.reason])).toEqual([
        ['X', 'lose', 'resign'],
        ['X', 'win', 'five_in_row'],
      ]);
      expect(theirs.data.map((match) => [match.you, match.outcome])).toEqual([
        ['O', 'win'],
        ['O', 'lose'],
      ]);
      expect(mine.data[0]).toEqual(
        expect.objectContaining({ playerX: 'alice', playerO: 'bob', moveCount: 0 }),
      );
    });

    it('should return an empty page for a player with no match', async () => {
      expect(await service.findHistory('nobody', { page: 1, limit: 20 })).toEqual({
        data: [],
        meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
      });
    });
  });
});
