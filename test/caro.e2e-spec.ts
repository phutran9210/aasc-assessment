import { performance } from 'node:perf_hooks';

import type { NestExpressApplication } from '@nestjs/platform-express';

import type { Socket } from 'socket.io-client';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { CaroMatch } from '../src/modules/caro/entities/caro-match.entity.js';
import type {
  MatchEndPayload,
  MatchStartPayload,
  MatchUpdatePayload,
} from '../src/modules/caro/types/index.js';
import { User } from '../src/modules/user/entities/user.entity.js';
import { createListeningTestApp } from './utils/create-test-app.js';
import { connectSocket, emitAck, nextEvent, registerAndLogin } from './utils/ws-client.js';

const NAMESPACE = '/caro';

type Seat = { socket: Socket; token: string; start: MatchStartPayload };

describe('Caro (e2e, WebSocket)', () => {
  let app: NestExpressApplication;
  let url: string;
  let dataSource: DataSource;
  const sockets: Socket[] = [];

  async function connectAs(username: string): Promise<{ socket: Socket; token: string }> {
    const token = await registerAndLogin(app, username);
    const socket = await connectSocket(url, NAMESPACE, token);
    sockets.push(socket);
    return { socket, token };
  }

  /** Two players matched together, returned as [the one playing X, the one playing O]. */
  async function startMatch(nameA: string, nameB: string): Promise<[Seat, Seat]> {
    const a = await connectAs(nameA);
    const b = await connectAs(nameB);
    const startA = nextEvent<MatchStartPayload>(a.socket, 'match:start');
    const startB = nextEvent<MatchStartPayload>(b.socket, 'match:start');
    await emitAck(a.socket, 'match:find');
    await emitAck(b.socket, 'match:find');
    const seats: Seat[] = [
      { ...a, start: await startA },
      { ...b, start: await startB },
    ];
    return seats[0].start.you === 'X' ? [seats[0], seats[1]] : [seats[1], seats[0]];
  }

  const move = (seat: Seat, row: number, col: number) =>
    emitAck<MatchUpdatePayload>(seat.socket, 'match:move', { row, col });

  /** X fills row 0 and O fills row 1 until X has five in a row. */
  async function playUntilXWins(x: Seat, o: Seat): Promise<void> {
    for (let col = 0; col < 5; col += 1) {
      await move(x, 0, col);
      if (col < 4) await move(o, 1, col);
    }
  }

  beforeAll(async () => {
    ({ app, url } = await createListeningTestApp());
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await dataSource.getRepository(CaroMatch).clear();
    await dataSource.getRepository(User).clear();
  });

  afterEach(async () => {
    sockets.splice(0).forEach((socket) => socket.close());
    // Let the server process the disconnects before the next test reuses the matchmaking queue.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('connection', () => {
    it('should refuse a client without a token', async () => {
      await expect(connectSocket(url, NAMESPACE)).rejects.toThrow(
        'Bạn cần đăng nhập để thực hiện thao tác này',
      );
    });
  });

  describe('match:find', () => {
    it('should make the first player wait and start the match when a second one arrives', async () => {
      const a = await connectAs('alice');
      const b = await connectAs('bob');
      const startA = nextEvent<MatchStartPayload>(a.socket, 'match:start');
      const startB = nextEvent<MatchStartPayload>(b.socket, 'match:start');

      expect(await emitAck(a.socket, 'match:find')).toEqual({
        ok: true,
        data: { status: 'waiting' },
      });
      expect(await emitAck(b.socket, 'match:find')).toEqual({
        ok: true,
        data: { status: 'matched' },
      });

      const [forA, forB] = [await startA, await startB];
      expect(forA.matchId).toBe(forB.matchId);
      expect([forA.you, forB.you].sort()).toEqual(['O', 'X']);
      expect(forA).toEqual(expect.objectContaining({ opponent: 'bob', size: 15, turn: 'X' }));
      expect(forB.opponent).toBe('alice');
    });

    it('should show the nickname to the opponent when the player has one', async () => {
      const a = await connectAs('alice');
      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ nickname: 'Cao thủ' })
        .expect(200);
      const b = await connectAs('bob');
      const startB = nextEvent<MatchStartPayload>(b.socket, 'match:start');

      await emitAck(a.socket, 'match:find');
      await emitAck(b.socket, 'match:find');

      expect((await startB).opponent).toBe('Cao thủ');
    });

    it('should refuse to search twice', async () => {
      const a = await connectAs('alice');
      await emitAck(a.socket, 'match:find');

      expect(await emitAck(a.socket, 'match:find')).toEqual({
        ok: false,
        message: 'Bạn đang trong hàng chờ ghép cặp',
      });
    });

    it('should not match a player who cancelled the search', async () => {
      const a = await connectAs('alice');
      const b = await connectAs('bob');
      await emitAck(a.socket, 'match:find');

      expect(await emitAck(a.socket, 'match:cancel')).toEqual({
        ok: true,
        data: { cancelled: true },
      });
      expect(await emitAck(b.socket, 'match:find')).toEqual({
        ok: true,
        data: { status: 'waiting' },
      });
    });
  });

  describe('match:move', () => {
    it('should send each move to both players and alternate the turn', async () => {
      const [x, o] = await startMatch('alice', 'bob');
      const seenByO = nextEvent<MatchUpdatePayload>(o.socket, 'match:update');
      const seenByX = nextEvent<MatchUpdatePayload>(x.socket, 'match:update');

      const ack = await move(x, 7, 7);

      const expected = {
        matchId: x.start.matchId,
        move: { row: 7, col: 7, symbol: 'X' },
        turn: 'O',
      };
      expect(ack).toEqual({ ok: true, data: expected });
      expect(await seenByO).toEqual(expected);
      expect(await seenByX).toEqual(expected);
    });

    it.each([
      ['out of turn', 'o', { row: 7, col: 7 }, 'Chưa đến lượt của bạn'],
      ['outside the board', 'x', { row: 15, col: 0 }, 'Ô không hợp lệ'],
      ['with a malformed body', 'x', 'giữa bàn', 'Ô không hợp lệ'],
    ])('should reject a move %s', async (_case, who, body, message) => {
      const [x, o] = await startMatch('alice', 'bob');

      const ack = await emitAck((who === 'x' ? x : o).socket, 'match:move', body);

      expect(ack).toEqual({ ok: false, message });
    });

    it('should reject a move on an occupied cell', async () => {
      const [x, o] = await startMatch('alice', 'bob');
      await move(x, 7, 7);

      expect(await move(o, 7, 7)).toEqual({ ok: false, message: 'Ô này đã được đánh' });
    });

    it('should announce the winner to both players and save the match history', async () => {
      const [x, o] = await startMatch('alice', 'bob');
      const endForX = nextEvent<MatchEndPayload>(x.socket, 'match:end');
      const endForO = nextEvent<MatchEndPayload>(o.socket, 'match:end');

      await playUntilXWins(x, o);

      const expected: MatchEndPayload = {
        matchId: x.start.matchId,
        result: 'x_win',
        reason: 'five_in_row',
        winner: 'X',
        line: [0, 1, 2, 3, 4].map((col) => ({ row: 0, col })),
      };
      expect(await endForX).toEqual(expected);
      expect(await endForO).toEqual(expected);
      expect(await move(o, 5, 5)).toEqual({ ok: false, message: 'Bạn không ở trong trận đấu nào' });

      const history = await request(app.getHttpServer())
        .get('/caro/matches')
        .set('Authorization', `Bearer ${o.token}`)
        .expect(200);
      expect(history.body.meta.total).toBe(1);
      expect(history.body.data[0]).toEqual(
        expect.objectContaining({
          id: x.start.matchId,
          you: 'O',
          outcome: 'lose',
          result: 'x_win',
          reason: 'five_in_row',
          moveCount: 9,
        }),
      );
    });
  });

  describe('leaving', () => {
    it('should give the win to the opponent when a player resigns', async () => {
      const [x, o] = await startMatch('alice', 'bob');
      const endForO = nextEvent<MatchEndPayload>(o.socket, 'match:end');

      expect(await emitAck(x.socket, 'match:leave')).toEqual({ ok: true, data: { left: true } });

      expect(await endForO).toEqual(
        expect.objectContaining({ result: 'o_win', reason: 'resign', winner: 'O' }),
      );
    });

    it('should give the win to the opponent when a player disconnects', async () => {
      const [x, o] = await startMatch('alice', 'bob');
      const endForX = nextEvent<MatchEndPayload>(x.socket, 'match:end');

      o.socket.close();

      expect(await endForX).toEqual(
        expect.objectContaining({ result: 'x_win', reason: 'disconnect', winner: 'X' }),
      );
      expect(await dataSource.getRepository(CaroMatch).count()).toBe(1);
    });

    it('should let both players search again after a match ends', async () => {
      const [x, o] = await startMatch('alice', 'bob');
      await emitAck(x.socket, 'match:leave');

      expect(await emitAck(x.socket, 'match:find')).toEqual({
        ok: true,
        data: { status: 'waiting' },
      });
      expect(await emitAck(o.socket, 'match:find')).toEqual({
        ok: true,
        data: { status: 'matched' },
      });
    });
  });

  describe('GET /caro/matches', () => {
    it('should return 401 without a token', async () => {
      await request(app.getHttpServer()).get('/caro/matches').expect(401);
    });
  });

  describe('performance', () => {
    it('should serve 10 concurrent players with every move acknowledged in under 200ms', async () => {
      // 10 players search at once; pairing is random, so tables are rebuilt from match ids.
      const players = await Promise.all(
        Array.from({ length: 10 }, (_, index) => connectAs(`player_${index}`)),
      );
      const starts = players.map(({ socket }) =>
        nextEvent<MatchStartPayload>(socket, 'match:start'),
      );
      await Promise.all(players.map(({ socket }) => emitAck(socket, 'match:find')));
      const seats: Seat[] = await Promise.all(
        players.map(async (player, index) => ({ ...player, start: await starts[index] })),
      );
      const tables = [...new Set(seats.map((seat) => seat.start.matchId))].map((matchId) => {
        const pair = seats.filter((seat) => seat.start.matchId === matchId);
        return pair[0].start.you === 'X' ? pair : [pair[1], pair[0]];
      });
      expect(tables).toHaveLength(5);

      const latencies: number[] = [];
      const timedMove = async (seat: Seat, row: number, col: number): Promise<void> => {
        const startedAt = performance.now();
        const ack = await move(seat, row, col);
        latencies.push(performance.now() - startedAt);
        if (!ack.ok) throw new Error(ack.message);
      };

      // All five tables play at the same time; each plays a full game (9 moves).
      await Promise.all(
        tables.map(async ([x, o]) => {
          for (let col = 0; col < 5; col += 1) {
            await timedMove(x, 0, col);
            if (col < 4) await timedMove(o, 1, col);
          }
        }),
      );

      const slowest = Math.max(...latencies);
      const average = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
      console.info(
        `Caro: 10 players, ${latencies.length} moves — avg ${average.toFixed(2)}ms, max ${slowest.toFixed(2)}ms`,
      );
      expect(latencies).toHaveLength(45);
      expect(slowest).toBeLessThan(200);
      expect(await dataSource.getRepository(CaroMatch).count()).toBe(5);
    });
  });
});
