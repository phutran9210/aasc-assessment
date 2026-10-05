import type { Namespace } from 'socket.io';

import { Line98Gateway } from '../gateways/line98.gateway.js';
import { LINE98_WS } from '../constants/index.js';
import type { Line98Service } from '../services/line98.service.js';
import type { AuthenticatedSocket } from '@modules/auth/ws/ws-auth.middleware.js';
import type { AuthService } from '@modules/auth/services/auth.service.js';
import type { Line98MoveResult, Line98State } from '../types/index.js';

const state: Line98State = {
  id: 'game-1',
  board: [[0]],
  nextColors: [1, 2, 3],
  score: 0,
  moveCount: 0,
  status: 'playing',
};

const moveResult: Line98MoveResult = {
  state,
  path: [{ row: 0, col: 0 }],
  cleared: [],
  spawned: [],
};

function client(): AuthenticatedSocket {
  return {
    id: 'socket-1',
    data: { user: { id: 'user-1', username: 'alice' } },
    join: jest.fn().mockResolvedValue(undefined),
    to: jest.fn().mockReturnValue({ emit: jest.fn() }),
  } as unknown as AuthenticatedSocket;
}

describe('Line98Gateway', () => {
  const line98Service = {
    getOrCreateGame: jest.fn(),
    newGame: jest.fn(),
    move: jest.fn(),
    hint: jest.fn(),
  };
  const authService = { verifyToken: jest.fn() };
  const server = {
    use: jest.fn(),
  } as unknown as Namespace;
  let gateway: Line98Gateway;

  beforeEach(() => {
    jest.resetAllMocks();
    gateway = new Line98Gateway(
      line98Service as unknown as Line98Service,
      authService as unknown as AuthService,
    );
  });

  it('should install the authentication middleware after initialization', () => {
    gateway.afterInit(server);

    expect(server.use).toHaveBeenCalledWith(expect.any(Function));
  });

  it('should join the user room when a socket connects', async () => {
    const socket = client();

    await gateway.handleConnection(socket);

    expect(socket.join).toHaveBeenCalledWith('user:user-1');
  });

  it('should acknowledge the current game on join', async () => {
    line98Service.getOrCreateGame.mockResolvedValue(state);

    await expect(gateway.join(client())).resolves.toEqual({ ok: true, data: state });
    expect(line98Service.getOrCreateGame).toHaveBeenCalledWith('user-1');
  });

  it('should start a new game, broadcast it, and acknowledge the state', async () => {
    line98Service.newGame.mockResolvedValue(state);
    const socket = client();
    const emit = jest.fn();
    (socket.to as jest.Mock).mockReturnValue({ emit });

    await expect(gateway.newGame(socket)).resolves.toEqual({ ok: true, data: state });
    expect(emit).toHaveBeenCalledWith(LINE98_WS.STATE, {
      state,
      path: [],
      cleared: [],
      spawned: [],
    });
  });

  it('should parse and delegate a move before broadcasting the result', async () => {
    line98Service.move.mockResolvedValue(moveResult);
    const socket = client();
    const emit = jest.fn();
    (socket.to as jest.Mock).mockReturnValue({ emit });

    await expect(
      gateway.move(socket, { from: { row: 1, col: 2 }, to: { row: 1, col: 3 } }),
    ).resolves.toEqual({ ok: true, data: moveResult });
    expect(line98Service.move).toHaveBeenCalledWith(
      'user-1',
      { row: 1, col: 2 },
      { row: 1, col: 3 },
    );
    expect(emit).toHaveBeenCalledWith(LINE98_WS.STATE, moveResult);
  });

  it('should acknowledge a hint without broadcasting', async () => {
    const hint = { from: { row: 1, col: 1 }, to: { row: 1, col: 2 } };
    line98Service.hint.mockResolvedValue(hint);

    await expect(gateway.hint(client())).resolves.toEqual({ ok: true, data: hint });
    expect(line98Service.hint).toHaveBeenCalledWith('user-1');
  });
});
