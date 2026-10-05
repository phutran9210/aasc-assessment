import { GameRuleError } from '@common/ws/index.js';

import { CARO } from '../constants/index.js';
import type { CaroSymbol } from '../constants/index.js';
import { CARO_MESSAGES } from '../messages/index.js';
import type { CaroBoard, Cell } from '../types/index.js';

/** Pure rules of Caro (gomoku, free style): no database, no sockets. */

const { SIZE, WIN_LENGTH } = CARO;

/** Horizontal, vertical and both diagonals. Each is scanned in both directions. */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

export function createBoard(): CaroBoard {
  return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
}

const isInside = (row: number, col: number): boolean =>
  row >= 0 && row < SIZE && col >= 0 && col < SIZE;

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
    throw new GameRuleError(CARO_MESSAGES.ERROR.INVALID_CELL);
  }
  return { row, col };
}

/** Writes the symbol on the board (mutates it). The cell must be empty. */
export function placeSymbol(board: CaroBoard, cell: Cell, symbol: CaroSymbol): void {
  if (board[cell.row][cell.col] !== null) {
    throw new GameRuleError(CARO_MESSAGES.ERROR.CELL_OCCUPIED);
  }
  board[cell.row][cell.col] = symbol;
}

/**
 * The winning line through `cell`, or null. Only lines through the last move can be new, so only
 * those are scanned. Five or more in a row wins (free-style rule: no blocked-ends exception).
 */
export function findWinningLine(board: CaroBoard, cell: Cell): Cell[] | null {
  const symbol = board[cell.row][cell.col];
  if (symbol === null) return null;

  for (const [rowStep, colStep] of DIRECTIONS) {
    const line: Cell[] = [cell];
    for (const sign of [1, -1]) {
      let row = cell.row + rowStep * sign;
      let col = cell.col + colStep * sign;
      while (isInside(row, col) && board[row][col] === symbol) {
        // Keep the cells ordered from one end of the line to the other.
        if (sign === 1) line.push({ row, col });
        else line.unshift({ row, col });
        row += rowStep * sign;
        col += colStep * sign;
      }
    }
    if (line.length >= WIN_LENGTH) return line;
  }
  return null;
}

export function isBoardFull(moveCount: number): boolean {
  return moveCount >= SIZE * SIZE;
}

export const otherSymbol = (symbol: CaroSymbol): CaroSymbol => (symbol === 'X' ? 'O' : 'X');
