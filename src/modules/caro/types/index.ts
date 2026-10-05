import type { CaroEndReason, CaroResult, CaroSymbol } from '../constants/index.js';

export type Cell = { row: number; col: number };

/** `board[row][col]` is 'X', 'O' or null (empty). */
export type CaroBoard = (CaroSymbol | null)[][];

export type CaroMove = Cell & { symbol: CaroSymbol };

/** A connected player taking part in matchmaking. */
export type CaroPlayer = {
  userId: string;
  /** Nickname if set, otherwise the username. */
  name: string;
  socketId: string;
};

/** A match being played. Lives in memory; it is written to the database when it ends. */
export type LiveMatch = {
  id: string;
  players: Record<CaroSymbol, CaroPlayer>;
  board: CaroBoard;
  moves: CaroMove[];
  turn: CaroSymbol;
  startedAt: Date;
};

/** How a match ended, as sent to both players. */
export type CaroOutcome = {
  result: CaroResult;
  reason: CaroEndReason;
  /** null for a draw. */
  winner: CaroSymbol | null;
  /** The five (or more) winning cells; empty unless the reason is five_in_row. */
  line: Cell[];
};

export type MatchmakingResult = { status: 'waiting' } | { status: 'matched'; match: LiveMatch };

export type MoveResult = {
  match: LiveMatch;
  move: CaroMove;
  /** Set when this move ended the match. */
  outcome: CaroOutcome | null;
};

// ── Payloads sent to the browser ──

/** `match:start`, personalised for each player. */
export type MatchStartPayload = {
  matchId: string;
  you: CaroSymbol;
  opponent: string;
  size: number;
  turn: CaroSymbol;
};

/** `match:update`: one move was played. */
export type MatchUpdatePayload = { matchId: string; move: CaroMove; turn: CaroSymbol };

/** `match:end`. */
export type MatchEndPayload = CaroOutcome & { matchId: string };

/** One finished match in the history list, seen from the requesting player's side. */
export type CaroMatchListItem = {
  id: string;
  playerX: string;
  playerO: string;
  you: CaroSymbol;
  /** 'win' | 'lose' | 'draw' for the requesting player. */
  outcome: 'win' | 'lose' | 'draw';
  result: CaroResult;
  reason: CaroEndReason;
  moveCount: number;
  startedAt: Date;
  finishedAt: Date;
};
