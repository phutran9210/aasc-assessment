import type { Namespace } from 'socket.io';

import type { AuthService } from '@modules/auth/services/auth.service.js';
import type { AuthenticatedSocket } from '@modules/auth/ws/ws-auth.middleware.js';
import type { UserService } from '@modules/user/services/user.service.js';

import { CARO_END_REASONS, CARO_WS } from '../constants/index.js';
import { CaroGateway } from '../gateways/caro.gateway.js';
import type { CaroMatchService } from '../services/caro-match.service.js';
import type { CaroOutcome, LiveMatch } from '../types/index.js';

const match: LiveMatch = {
  id: 'match-1',
  players: {
    X: { userId: 'user-x', name: 'Alice', socketId: 'socket-x' },
    O: { userId: 'user-o', name: 'Bob', socketId: 'socket-o' },
  },
  board: [],
  moves: [],
  turn: 'X',
  startedAt: new Date('2026-10-04T15:00:00.000Z'),
};

const outcome: CaroOutcome = {
  result: 'x_win',
  reason: 'five_in_row',
  winner: 'X',
  line: [{ row: 0, col: 0 }],
};

function client(id = 'socket-x'): AuthenticatedSocket {
  return {
    id,
    data: { user: { id: id === 'socket-x' ? 'user-x' : 'user-o', username: id } },
  } as unknown as AuthenticatedSocket;
}

describe('CaroGateway', () => {
  const matchService = {
    cancelSearch: jest.fn(),
    findMatch: jest.fn(),
    move: jest.fn(),
    forfeit: jest.fn(),
  };
  const authService = { verifyToken: jest.fn() };
  const userService = { getProfile: jest.fn() };
  const emit = jest.fn();
  const socketsJoin = jest.fn();
  const socketsLeave = jest.fn();
  const server = {
    use: jest.fn(),
    in: jest.fn().mockReturnValue({ socketsJoin, socketsLeave }),
    to: jest.fn().mockReturnValue({ emit }),
  } as unknown as Namespace;
  let gateway: CaroGateway;

  beforeEach(() => {
    jest.resetAllMocks();
    (server.in as jest.Mock).mockReturnValue({ socketsJoin, socketsLeave });
    (server.to as jest.Mock).mockReturnValue({ emit });
    gateway = new CaroGateway(
      matchService as unknown as CaroMatchService,
      authService as unknown as AuthService,
      userService as unknown as UserService,
    );
    (gateway as unknown as { server: Namespace }).server = server;
  });

  it('should install authentication middleware after initialization', () => {
    gateway.afterInit(server);

    expect(server.use).toHaveBeenCalledWith(expect.any(Function));
  });

  it('should remove a disconnected socket from search and leave active matches alone', async () => {
    matchService.forfeit.mockResolvedValue(null);

    await gateway.handleDisconnect(client());

    expect(matchService.cancelSearch).toHaveBeenCalledWith('socket-x');
    expect(matchService.forfeit).toHaveBeenCalledWith('socket-x', CARO_END_REASONS.DISCONNECT);
    expect(emit).not.toHaveBeenCalled();
  });

  it('should acknowledge a player waiting for an opponent', async () => {
    userService.getProfile.mockResolvedValue({ nickname: null });
    matchService.findMatch.mockReturnValue({ status: 'waiting' });

    await expect(gateway.find(client())).resolves.toEqual({
      ok: true,
      data: { status: 'waiting' },
    });
    expect(matchService.findMatch).toHaveBeenCalledWith({
      userId: 'user-x',
      name: 'socket-x',
      socketId: 'socket-x',
    });
  });

  it('should start and announce a matched game to both sockets', async () => {
    userService.getProfile.mockResolvedValue({ nickname: 'Alice' });
    matchService.findMatch.mockReturnValue({ status: 'matched', match });

    await expect(gateway.find(client())).resolves.toEqual({
      ok: true,
      data: { status: 'matched' },
    });
    expect(socketsJoin).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith(
      CARO_WS.START,
      expect.objectContaining({ matchId: 'match-1' }),
    );
    expect(emit).toHaveBeenCalledWith(
      CARO_WS.START,
      expect.objectContaining({ you: 'X', opponent: 'Bob', turn: 'X' }),
    );
  });

  it('should acknowledge cancellation and return the service result', async () => {
    matchService.cancelSearch.mockReturnValue(true);

    await expect(gateway.cancel(client())).resolves.toEqual({
      ok: true,
      data: { cancelled: true },
    });
  });

  it('should broadcast a move update without ending an active match', async () => {
    const move = { row: 2, col: 3, symbol: 'X' as const };
    matchService.move.mockResolvedValue({ match, move, outcome: null });

    await expect(gateway.move(client(), { row: 2, col: 3 })).resolves.toEqual({
      ok: true,
      data: { matchId: 'match-1', move, turn: 'X' },
    });
    expect(emit).toHaveBeenCalledWith(CARO_WS.UPDATE, {
      matchId: 'match-1',
      move,
      turn: 'X',
    });
  });

  it('should announce the end and remove the room after a winning move', async () => {
    const move = { row: 0, col: 4, symbol: 'X' as const };
    matchService.move.mockResolvedValue({ match, move, outcome });

    await gateway.move(client(), { row: 0, col: 4 });

    expect(emit).toHaveBeenCalledWith(CARO_WS.END, { matchId: 'match-1', ...outcome });
    expect(socketsLeave).toHaveBeenCalledWith('match:match-1');
  });

  it('should acknowledge a leave and announce a forfeit when one exists', async () => {
    matchService.forfeit.mockResolvedValue({ match, outcome });

    await expect(gateway.leave(client())).resolves.toEqual({ ok: true, data: { left: true } });
    expect(matchService.forfeit).toHaveBeenCalledWith('socket-x', CARO_END_REASONS.RESIGN);
    expect(emit).toHaveBeenCalledWith(CARO_WS.END, { matchId: 'match-1', ...outcome });
  });
});
