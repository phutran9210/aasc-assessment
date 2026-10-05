import { performance } from 'node:perf_hooks';

import type { NestExpressApplication } from '@nestjs/platform-express';

import type { Socket } from 'socket.io-client';
import { DataSource } from 'typeorm';

import { Line98Game } from '../src/modules/line98/entities/line98-game.entity.js';
import type {
  Line98Hint,
  Line98MoveResult,
  Line98State,
} from '../src/modules/line98/types/index.js';
import { User } from '../src/modules/user/entities/user.entity.js';
import { createListeningTestApp } from './utils/create-test-app.js';
import { connectSocket, emitAck, nextEvent, registerAndLogin } from './utils/ws-client.js';

const NAMESPACE = '/line98';

describe('Line 98 (e2e, WebSocket)', () => {
  let app: NestExpressApplication;
  let url: string;
  let dataSource: DataSource;
  let token: string;
  const sockets: Socket[] = [];

  const connect = async (accessToken?: string): Promise<Socket> => {
    const socket = await connectSocket(url, NAMESPACE, accessToken);
    sockets.push(socket);
    return socket;
  };

  beforeAll(async () => {
    ({ app, url } = await createListeningTestApp());
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await dataSource.getRepository(Line98Game).clear();
    await dataSource.getRepository(User).clear();
    token = await registerAndLogin(app, 'alice');
  });

  afterEach(() => {
    sockets.splice(0).forEach((socket) => socket.close());
  });

  afterAll(async () => {
    await app.close();
  });

  describe('connection', () => {
    it.each([
      ['no token', undefined, 'Bạn cần đăng nhập để thực hiện thao tác này'],
      ['an invalid token', 'abc.def.ghi', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn'],
    ])(
      'should refuse the connection when the client sends %s',
      async (_case, badToken, message) => {
        await expect(connect(badToken)).rejects.toThrow(message);
      },
    );
  });

  describe('game:join', () => {
    it('should send a new 9x9 board with 5 balls and 3 announced colours', async () => {
      const socket = await connect(token);

      const ack = await emitAck<Line98State>(socket, 'game:join');

      expect(ack.ok).toBe(true);
      if (!ack.ok) return;
      expect(ack.data.board).toHaveLength(9);
      expect(ack.data.board.flat().filter((color) => color !== 0)).toHaveLength(5);
      expect(ack.data.nextColors).toHaveLength(3);
      expect(ack.data).toEqual(
        expect.objectContaining({ score: 0, moveCount: 0, status: 'playing' }),
      );
    });

    it('should resume the saved game after the player reconnects', async () => {
      const first = await connect(token);
      await emitAck<Line98State>(first, 'game:join');
      const hint = await emitAck<Line98Hint>(first, 'game:hint');
      if (!hint.ok) throw new Error(hint.message);
      const moved = await emitAck<Line98MoveResult>(first, 'game:move', hint.data);
      if (!moved.ok) throw new Error(moved.message);
      first.close();

      const second = await connect(token);
      const resumed = await emitAck<Line98State>(second, 'game:join');

      expect(resumed).toEqual({ ok: true, data: moved.data.state });
      expect(await dataSource.getRepository(Line98Game).count()).toBe(1);
    });
  });

  describe('game:move', () => {
    it('should move the ball, add 3 balls and report the path', async () => {
      const socket = await connect(token);
      await emitAck<Line98State>(socket, 'game:join');
      const hint = await emitAck<Line98Hint>(socket, 'game:hint');
      if (!hint.ok) throw new Error(hint.message);

      const ack = await emitAck<Line98MoveResult>(socket, 'game:move', hint.data);

      expect(ack.ok).toBe(true);
      if (!ack.ok) return;
      const { state, path, spawned } = ack.data;
      expect(path[0]).toEqual(hint.data.from);
      expect(path.at(-1)).toEqual(hint.data.to);
      expect(state.board[hint.data.to.row][hint.data.to.col]).not.toBe(0);
      // The origin is empty again, unless one of the new balls happened to land on it.
      const originRefilled = spawned.some(
        (cell) => cell.row === hint.data.from.row && cell.col === hint.data.from.col,
      );
      expect(state.board[hint.data.from.row][hint.data.from.col] === 0 || originRefilled).toBe(
        true,
      );
      expect(spawned).toHaveLength(3);
      expect(state.moveCount).toBe(1);
    });

    it.each([
      [
        'a cell outside the board',
        { from: { row: 0, col: 0 }, to: { row: 9, col: 0 } },
        'Ô không hợp lệ',
      ],
      ['a missing body', undefined, 'Ô không hợp lệ'],
      ['text instead of cells', { from: 'a1', to: 'b2' }, 'Ô không hợp lệ'],
    ])('should answer with an error ack when the client sends %s', async (_case, body, message) => {
      const socket = await connect(token);
      await emitAck<Line98State>(socket, 'game:join');

      expect(await emitAck(socket, 'game:move', body)).toEqual({ ok: false, message });
    });

    it('should reject moving from an empty cell and keep the connection usable', async () => {
      const socket = await connect(token);
      const joined = await emitAck<Line98State>(socket, 'game:join');
      if (!joined.ok) throw new Error(joined.message);
      const empties = joined.data.board
        .flatMap((line, row) => line.map((color, col) => ({ row, col, color })))
        .filter((cell) => cell.color === 0);

      const ack = await emitAck(socket, 'game:move', { from: empties[0], to: empties[1] });

      expect(ack).toEqual({ ok: false, message: 'Ô được chọn không có bóng' });
      expect((await emitAck<Line98Hint>(socket, 'game:hint')).ok).toBe(true);
    });

    it('should push the new state to the other tabs of the same player only', async () => {
      const tabA = await connect(token);
      const tabB = await connect(token);
      const stranger = await connect(await registerAndLogin(app, 'bob'));
      await emitAck<Line98State>(tabA, 'game:join');
      await emitAck<Line98State>(tabB, 'game:join');
      await emitAck<Line98State>(stranger, 'game:join');
      const strangerEvents: unknown[] = [];
      stranger.on('game:state', (event) => strangerEvents.push(event));
      const pushed = nextEvent<Line98MoveResult>(tabB, 'game:state');
      const hint = await emitAck<Line98Hint>(tabA, 'game:hint');
      if (!hint.ok) throw new Error(hint.message);

      const ack = await emitAck<Line98MoveResult>(tabA, 'game:move', hint.data);

      expect(await pushed).toEqual(ack.ok ? ack.data : undefined);
      expect(strangerEvents).toEqual([]);
    });
  });

  describe('game:new', () => {
    it('should replace the current game with a fresh one', async () => {
      const socket = await connect(token);
      const first = await emitAck<Line98State>(socket, 'game:join');

      const second = await emitAck<Line98State>(socket, 'game:new');

      expect(first.ok && second.ok && second.data.id !== first.data.id).toBe(true);
      expect(second.ok && second.data.moveCount).toBe(0);
    });
  });

  describe('performance', () => {
    it('should serve 10 concurrent players with every move acknowledged in under 200ms', async () => {
      const MOVES_PER_PLAYER = 10;
      const players = await Promise.all(
        Array.from({ length: 10 }, async (_, index) => {
          const socket = await connect(await registerAndLogin(app, `line_player_${index}`));
          await emitAck<Line98State>(socket, 'game:join');
          return socket;
        }),
      );
      const latencies: number[] = [];

      // All ten players play at the same time; every move loads and saves a board in SQLite.
      await Promise.all(
        players.map(async (socket) => {
          for (let turn = 0; turn < MOVES_PER_PLAYER; turn += 1) {
            const hint = await emitAck<Line98Hint>(socket, 'game:hint');
            if (!hint.ok) throw new Error(hint.message);

            const startedAt = performance.now();
            const ack = await emitAck<Line98MoveResult>(socket, 'game:move', hint.data);
            latencies.push(performance.now() - startedAt);
            if (!ack.ok) throw new Error(ack.message);
          }
        }),
      );

      const slowest = Math.max(...latencies);
      const average = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
      console.info(
        `Line 98: 10 players, ${latencies.length} moves — avg ${average.toFixed(2)}ms, max ${slowest.toFixed(2)}ms`,
      );
      expect(latencies).toHaveLength(100);
      expect(slowest).toBeLessThan(200);
      const games = await dataSource.getRepository(Line98Game).find();
      expect(games).toHaveLength(10);
      expect(games.every((game) => game.moveCount === MOVES_PER_PLAYER)).toBe(true);
    });
  });
});
