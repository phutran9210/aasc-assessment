import { GameRuleError } from '@common/ws/index.js';

import { LINE98 } from '../constants/index.js';
import { LINE98_MESSAGES } from '../messages/index.js';
import type { Board, Cell, Line98Hint, Rng } from '../types/index.js';

/**
 * Pure rules of Line 98: no database, no sockets, no hidden randomness (the RNG is a parameter).
 * Functions never mutate their arguments; they return new boards.
 */

const { SIZE, COLOR_COUNT, EMPTY, LINE_LENGTH } = LINE98;

/** Up, down, left, right: a ball moves only through orthogonally adjacent empty cells. */
const STEPS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/** Horizontal, vertical and both diagonals. Each is scanned in both directions. */
const LINE_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

export type EngineState = {
  board: Board;
  nextColors: number[];
  score: number;
};

export type EngineMoveResult = EngineState & {
  path: Cell[];
  cleared: Cell[];
  spawned: Cell[];
  isOver: boolean;
};

export function createEmptyBoard(): Board {
  return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => EMPTY));
}

const cloneBoard = (board: Board): Board => board.map((row) => [...row]);

const isInside = (row: number, col: number): boolean =>
  row >= 0 && row < SIZE && col >= 0 && col < SIZE;

const cellKey = (cell: Cell): number => cell.row * SIZE + cell.col;

/** Validates untrusted input (it comes from the network) and returns a clean cell. */
export function parseCell(value: unknown): Cell {
  const { row, col } = (value ?? {}) as Partial<Cell>;
  if (
    typeof row !== 'number' ||
    typeof col !== 'number' ||
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    !isInside(row, col)
  ) {
    throw new GameRuleError(LINE98_MESSAGES.ERROR.INVALID_CELL);
  }
  return { row, col };
}

export function emptyCells(board: Board): Cell[] {
  const cells: Cell[] = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if (board[row][col] === EMPTY) cells.push({ row, col });
    }
  }
  return cells;
}

const randomIndex = (length: number, rng: Rng): number =>
  Math.min(Math.floor(rng() * length), length - 1);

export function randomColors(count: number, rng: Rng): number[] {
  return Array.from({ length: count }, () => 1 + randomIndex(COLOR_COUNT, rng));
}

/** Puts each colour on a random empty cell; stops early when the board fills up. */
function placeBalls(board: Board, colors: number[], rng: Rng): Cell[] {
  const free = emptyCells(board);
  const placed: Cell[] = [];

  for (const color of colors) {
    if (free.length === 0) break;
    const [cell] = free.splice(randomIndex(free.length, rng), 1);
    board[cell.row][cell.col] = color;
    placed.push(cell);
  }
  return placed;
}

export function createGame(rng: Rng = Math.random): EngineState {
  const board = createEmptyBoard();
  placeBalls(board, randomColors(LINE98.INITIAL_BALLS, rng), rng);

  return { board, nextColors: randomColors(LINE98.SPAWN_COUNT, rng), score: 0 };
}

/**
 * Shortest path for a ball (breadth-first search through empty cells).
 * Returns the cells from `from` to `to` inclusive, or null when the target is unreachable.
 */
export function findPath(board: Board, from: Cell, to: Cell): Cell[] | null {
  const previous = new Map<number, Cell | null>([[cellKey(from), null]]);
  const queue: Cell[] = [from];

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current.row === to.row && current.col === to.col) {
      const path: Cell[] = [];
      for (let step: Cell | null = current; step; step = previous.get(cellKey(step)) ?? null) {
        path.unshift(step);
      }
      return path;
    }

    for (const [rowStep, colStep] of STEPS) {
      const next = { row: current.row + rowStep, col: current.col + colStep };
      if (!isInside(next.row, next.col) || previous.has(cellKey(next))) continue;
      if (board[next.row][next.col] !== EMPTY) continue;
      previous.set(cellKey(next), current);
      queue.push(next);
    }
  }
  return null;
}

/**
 * Cells of every run of LINE_LENGTH or more same-coloured balls that passes through one of
 * `origins`. Only lines through cells that just changed can be new, so only those are scanned.
 */
export function findLines(board: Board, origins: Cell[]): Cell[] {
  const found = new Map<number, Cell>();

  for (const origin of origins) {
    const color = board[origin.row][origin.col];
    if (color === EMPTY) continue;

    for (const [rowStep, colStep] of LINE_DIRECTIONS) {
      const line: Cell[] = [origin];
      for (const sign of [1, -1]) {
        let row = origin.row + rowStep * sign;
        let col = origin.col + colStep * sign;
        while (isInside(row, col) && board[row][col] === color) {
          line.push({ row, col });
          row += rowStep * sign;
          col += colStep * sign;
        }
      }
      if (line.length >= LINE_LENGTH) line.forEach((cell) => found.set(cellKey(cell), cell));
    }
  }
  return [...found.values()];
}

function clearCells(board: Board, cells: Cell[]): void {
  for (const cell of cells) board[cell.row][cell.col] = EMPTY;
}

/**
 * Plays one move (one turn).
 * 1. The ball must exist, the target must be empty and reachable.
 * 2. A line completed by the move is cleared; each ball scores 1 point.
 * 3. The announced `nextColors` balls then appear on random empty cells — after every turn,
 *    as the brief requires ("sinh ngẫu nhiên 3 bóng mới sau mỗi lượt"), whether or not a
 *    line was cleared. Lines they complete are cleared and scored too.
 * 4. The game is over when the board is full afterwards.
 */
export function applyMove(
  state: EngineState,
  from: Cell,
  to: Cell,
  rng: Rng = Math.random,
): EngineMoveResult {
  const { ERROR } = LINE98_MESSAGES;
  if (emptyCells(state.board).length === 0) throw new GameRuleError(ERROR.GAME_OVER);
  if (state.board[from.row][from.col] === EMPTY) throw new GameRuleError(ERROR.NO_BALL);
  if (from.row === to.row && from.col === to.col) throw new GameRuleError(ERROR.SAME_CELL);
  if (state.board[to.row][to.col] !== EMPTY) throw new GameRuleError(ERROR.TARGET_OCCUPIED);

  const path = findPath(state.board, from, to);
  if (!path) throw new GameRuleError(ERROR.NO_PATH);

  const board = cloneBoard(state.board);
  board[to.row][to.col] = board[from.row][from.col];
  board[from.row][from.col] = EMPTY;

  const clearedByMove = findLines(board, [to]);
  clearCells(board, clearedByMove);

  const spawned = placeBalls(board, state.nextColors, rng);
  const clearedBySpawn = findLines(board, spawned);
  clearCells(board, clearedBySpawn);

  const cleared = [...clearedByMove, ...clearedBySpawn];
  const nextColors = randomColors(LINE98.SPAWN_COUNT, rng);

  return {
    board,
    nextColors,
    score: state.score + cleared.length,
    path,
    cleared,
    spawned,
    isOver: emptyCells(board).length === 0,
  };
}

/** A random legal move: a random ball that can move, and a random cell it can reach. */
export function pickHint(board: Board, rng: Rng = Math.random): Line98Hint | null {
  const balls: Cell[] = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if (board[row][col] !== EMPTY) balls.push({ row, col });
    }
  }

  while (balls.length > 0) {
    const [from] = balls.splice(randomIndex(balls.length, rng), 1);
    const targets = emptyCells(board).filter((cell) => findPath(board, from, cell) !== null);
    if (targets.length > 0) return { from, to: targets[randomIndex(targets.length, rng)] };
  }
  return null;
}
