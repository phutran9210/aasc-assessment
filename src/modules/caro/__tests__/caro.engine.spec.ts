import { GameRuleError } from '@common/ws/index.js';

import type { CaroSymbol } from '../constants/index.js';
import {
  createBoard,
  findWinningLine,
  isBoardFull,
  otherSymbol,
  parseCell,
  placeSymbol,
} from '../engine/caro.engine.js';
import type { CaroBoard, Cell } from '../types/index.js';

const cell = (row: number, col: number): Cell => ({ row, col });

function boardWith(symbol: CaroSymbol, cells: Cell[]): CaroBoard {
  const board = createBoard();
  cells.forEach((target) => placeSymbol(board, target, symbol));
  return board;
}

describe('caro engine', () => {
  describe('createBoard', () => {
    it('should create an empty 15x15 board', () => {
      const board = createBoard();

      expect(board).toHaveLength(15);
      expect(board.every((row) => row.length === 15 && row.every((value) => value === null))).toBe(
        true,
      );
    });
  });

  describe('parseCell', () => {
    it('should return the cell when it is inside the board', () => {
      expect(parseCell({ row: 14, col: 0 })).toEqual(cell(14, 0));
    });

    it.each([
      [{ row: 15, col: 0 }],
      [{ row: 0, col: -1 }],
      [{ row: 0.5, col: 1 }],
      [{ col: 1 }],
      [null],
      ['7,7'],
    ])('should throw GameRuleError when the value is %p', (value) => {
      expect(() => parseCell(value)).toThrow(new GameRuleError('Ô không hợp lệ'));
    });
  });

  describe('placeSymbol', () => {
    it('should write the symbol on an empty cell', () => {
      const board = createBoard();

      placeSymbol(board, cell(7, 7), 'X');

      expect(board[7][7]).toBe('X');
    });

    it('should throw GameRuleError and keep the cell when it is occupied', () => {
      const board = boardWith('X', [cell(7, 7)]);

      expect(() => placeSymbol(board, cell(7, 7), 'O')).toThrow(
        new GameRuleError('Ô này đã được đánh'),
      );
      expect(board[7][7]).toBe('X');
    });
  });

  describe('findWinningLine', () => {
    it.each([
      ['horizontal', [0, 1, 2, 3, 4].map((i) => cell(7, 3 + i))],
      ['vertical', [0, 1, 2, 3, 4].map((i) => cell(2 + i, 9))],
      ['diagonal down-right', [0, 1, 2, 3, 4].map((i) => cell(i, i))],
      ['diagonal down-left', [0, 1, 2, 3, 4].map((i) => cell(i, 14 - i))],
      ['along the bottom edge', [0, 1, 2, 3, 4].map((i) => cell(14, 10 + i))],
    ])('should find a %s line of five from any of its cells', (_name, cells) => {
      const board = boardWith('X', cells);

      for (const origin of cells) {
        const line = findWinningLine(board, origin);

        expect(line).toHaveLength(5);
        expect(line).toEqual(expect.arrayContaining(cells));
      }
    });

    it('should return the cells in order from one end to the other', () => {
      const cells = [0, 1, 2, 3, 4].map((i) => cell(7, 3 + i));

      expect(findWinningLine(boardWith('O', cells), cell(7, 5))).toEqual(cells);
    });

    it('should accept more than five in a row', () => {
      const cells = [0, 1, 2, 3, 4, 5].map((i) => cell(7, i));

      expect(findWinningLine(boardWith('X', cells), cell(7, 2))).toHaveLength(6);
    });

    it('should return null for four in a row', () => {
      const cells = [0, 1, 2, 3].map((i) => cell(7, i));

      expect(findWinningLine(boardWith('X', cells), cell(7, 3))).toBeNull();
    });

    it('should return null when the run is broken by the opponent', () => {
      const board = boardWith('X', [cell(7, 0), cell(7, 1), cell(7, 3), cell(7, 4)]);
      placeSymbol(board, cell(7, 2), 'O');

      expect(findWinningLine(board, cell(7, 1))).toBeNull();
      expect(findWinningLine(board, cell(7, 2))).toBeNull();
    });

    it('should return null for an empty cell', () => {
      expect(findWinningLine(createBoard(), cell(7, 7))).toBeNull();
    });
  });

  describe('isBoardFull', () => {
    it('should be true only when all 225 cells are played', () => {
      expect(isBoardFull(224)).toBe(false);
      expect(isBoardFull(225)).toBe(true);
    });
  });

  describe('otherSymbol', () => {
    it('should swap X and O', () => {
      expect(otherSymbol('X')).toBe('O');
      expect(otherSymbol('O')).toBe('X');
    });
  });
});
