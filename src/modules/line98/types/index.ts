import type { Line98Status } from '../constants/index.js';

export type Cell = { row: number; col: number };

/** `board[row][col]` is 0 (empty) or a colour 1..5. */
export type Board = number[][];

/** Random source in [0, 1). Injected so that tests can make the game deterministic. */
export type Rng = () => number;

/** What the client needs to draw a game. */
export type Line98State = {
  id: string;
  board: Board;
  /** Colours of the balls that will appear after the next move. */
  nextColors: number[];
  score: number;
  moveCount: number;
  status: Line98Status;
};

/** Result of one move: the new state plus what happened, for animations. */
export type Line98MoveResult = {
  state: Line98State;
  /** Cells the ball travelled through, from origin to target. */
  path: Cell[];
  /** Cells emptied because they completed a line. */
  cleared: Cell[];
  /** Cells where new balls appeared. */
  spawned: Cell[];
};

export type Line98Hint = { from: Cell; to: Cell };
