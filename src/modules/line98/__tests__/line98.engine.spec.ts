import { GameRuleError } from '@common/ws/index.js';

import {
  applyMove,
  createEmptyBoard,
  createGame,
  emptyCells,
  findLines,
  findPath,
  parseCell,
  pickHint,
} from '../engine/line98.engine.js';
import type { Board, Cell, Rng } from '../types/index.js';

/** Builds a 9x9 board from rows of digits ('.' = empty). Missing rows are empty. */
function boardOf(...rows: string[]): Board {
  const board = createEmptyBoard();
  rows.forEach((line, row) => {
    [...line].forEach((char, col) => {
      board[row][col] = char === '.' ? 0 : Number(char);
    });
  });
  return board;
}

/** Deterministic RNG: returns the given values in a loop. */
const sequence = (...values: number[]): Rng => {
  let index = 0;
  return () => values[index++ % values.length];
};

const cell = (row: number, col: number): Cell => ({ row, col });
const countBalls = (board: Board): number => 81 - emptyCells(board).length;
const sortCells = (cells: Cell[]): Cell[] =>
  [...cells].sort((a, b) => a.row - b.row || a.col - b.col);

describe('line98 engine', () => {
  describe('createGame', () => {
    it('should start with 5 balls, 3 announced colours and score 0', () => {
      const game = createGame();

      expect(game.board).toHaveLength(9);
      expect(game.board.every((row) => row.length === 9)).toBe(true);
      expect(countBalls(game.board)).toBe(5);
      expect(game.nextColors).toHaveLength(3);
      expect(game.score).toBe(0);
    });

    it('should only use colours 1 to 5 whatever the random source returns', () => {
      for (const rng of [sequence(0), sequence(0.999999), sequence(1), Math.random]) {
        const game = createGame(rng);
        const colors = [...game.board.flat().filter((value) => value !== 0), ...game.nextColors];

        expect(colors.every((color) => color >= 1 && color <= 5)).toBe(true);
      }
    });
  });

  describe('parseCell', () => {
    it('should return the cell when it is inside the board', () => {
      expect(parseCell({ row: 0, col: 8, extra: 'ignored' })).toEqual({ row: 0, col: 8 });
    });

    it.each([
      [{ row: -1, col: 0 }],
      [{ row: 0, col: 9 }],
      [{ row: 1.5, col: 0 }],
      [{ row: '1', col: 0 }],
      [{ row: 1 }],
      [null],
      [undefined],
      ['0,0'],
    ])('should throw GameRuleError when the value is %p', (value) => {
      expect(() => parseCell(value)).toThrow(new GameRuleError('Ô không hợp lệ'));
    });
  });

  describe('findPath', () => {
    it('should return a shortest path from origin to target on an open board', () => {
      const board = boardOf('1');

      const path = findPath(board, cell(0, 0), cell(0, 3));

      expect(path).toEqual([cell(0, 0), cell(0, 1), cell(0, 2), cell(0, 3)]);
    });

    it('should go around obstacles when the direct way is blocked', () => {
      const board = boardOf('12.', '.2.', '...');

      const path = findPath(board, cell(0, 0), cell(0, 2));

      expect(path?.[0]).toEqual(cell(0, 0));
      expect(path?.at(-1)).toEqual(cell(0, 2));
      expect(path).toHaveLength(7); // down 2, right 2, up 2
      expect(path?.every((step, index) => index === 0 || board[step.row][step.col] === 0)).toBe(
        true,
      );
    });

    it('should return null when the ball is walled in (diagonal gaps do not count)', () => {
      const board = boardOf('12', '2.');

      expect(findPath(board, cell(0, 0), cell(1, 1))).toBeNull();
      expect(findPath(board, cell(0, 0), cell(8, 8))).toBeNull();
    });
  });

  describe('findLines', () => {
    it.each([
      ['horizontal', boardOf('11111'), cell(0, 2), 5],
      ['vertical', boardOf('2', '2', '2', '2', '2'), cell(4, 0), 5],
      ['diagonal down-right', boardOf('3', '.3', '..3', '...3', '....3'), cell(2, 2), 5],
      ['diagonal down-left', boardOf('....4', '...4', '..4', '.4', '4'), cell(0, 4), 5],
      ['longer than five', boardOf('5555555'), cell(0, 6), 7],
    ])('should find a %s line', (_name, board, origin, length) => {
      expect(findLines(board, [origin])).toHaveLength(length);
    });

    it('should not report four in a row or five of mixed colours', () => {
      expect(findLines(boardOf('1111.'), [cell(0, 0)])).toEqual([]);
      expect(findLines(boardOf('11211'), [cell(0, 2)])).toEqual([]);
    });

    it('should count the crossing cell once when two lines intersect', () => {
      const board = boardOf('..1', '..1', '11111', '..1', '..1');

      expect(findLines(board, [cell(2, 2)])).toHaveLength(9);
    });

    it('should ignore an empty origin', () => {
      expect(findLines(boardOf('11111'), [cell(5, 5)])).toEqual([]);
    });
  });

  describe('applyMove', () => {
    const state = (board: Board, nextColors = [1, 2, 3], score = 0) => ({
      board,
      nextColors,
      score,
    });

    it('should move the ball and add the 3 announced balls when no line is made', () => {
      const before = state(boardOf('1'), [2, 3, 4]);

      const result = applyMove(before, cell(0, 0), cell(4, 4), sequence(0.5));

      expect(result.board[0][0]).toBe(0);
      expect(result.board[4][4]).toBe(1);
      expect(result.spawned).toHaveLength(3);
      expect(result.spawned.map((spawn) => result.board[spawn.row][spawn.col]).sort()).toEqual([
        2, 3, 4,
      ]);
      expect(countBalls(result.board)).toBe(4);
      expect(result.cleared).toEqual([]);
      expect(result.score).toBe(0);
      expect(result.nextColors).toHaveLength(3);
      expect(result.isOver).toBe(false);
      expect(result.path[0]).toEqual(cell(0, 0));
      expect(result.path.at(-1)).toEqual(cell(4, 4));
    });

    it('should not mutate the state it is given', () => {
      const before = state(boardOf('1'));
      const snapshot = JSON.stringify(before);

      applyMove(before, cell(0, 0), cell(4, 4));

      expect(JSON.stringify(before)).toBe(snapshot);
    });

    it('should clear the line, score one point per ball and still add 3 balls when a line is made', () => {
      const before = state(boardOf('1111.', '....1'), [2, 3, 4], 10);

      const result = applyMove(before, cell(1, 4), cell(0, 4), sequence(0.5));

      expect(sortCells(result.cleared)).toEqual([0, 1, 2, 3, 4].map((col) => cell(0, col)));
      expect(result.score).toBe(15);
      // "Sinh ngẫu nhiên 3 bóng mới sau mỗi lượt": the announced balls appear on every turn.
      expect(result.spawned).toHaveLength(3);
      expect(result.spawned.map((spawn) => result.board[spawn.row][spawn.col]).sort()).toEqual([
        2, 3, 4,
      ]);
      expect(countBalls(result.board)).toBe(3);
      expect(result.nextColors).toHaveLength(3);
      expect(result.isOver).toBe(false);
    });

    it('should let new balls land on cells that the move has just cleared', () => {
      const before = state(boardOf('1111.', '....1'), [2, 2, 2]);

      // rng 0 always picks the first empty cell: (0,0), (0,1), (0,2) — part of the cleared line.
      const result = applyMove(before, cell(1, 4), cell(0, 4), sequence(0));

      expect(result.spawned).toEqual([cell(0, 0), cell(0, 1), cell(0, 2)]);
      expect(result.board[0].slice(0, 5)).toEqual([2, 2, 2, 0, 0]);
      expect(result.score).toBe(5);
    });

    it('should clear both the line made by the move and a line completed by a new ball', () => {
      // The move completes row 0 (colour 1). Column 8 has four 3s with a gap at (4,8):
      // the first spawned ball (colour 3) is steered there and completes a second line.
      const board = boardOf(
        '1111.....',
        '....1...3',
        '........3',
        '........3',
        '.........',
        '........3',
      );
      const emptyBefore = 81 - 9; // 9 balls on the board
      // After the move and the first clear there are 77 empty cells; (4,8) is one of them.
      const afterClear = boardOf(
        '.........',
        '........3',
        '........3',
        '........3',
        '.........',
        '........3',
      );
      const targetIndex = emptyCells(afterClear).findIndex((c) => c.row === 4 && c.col === 8);
      const steer = sequence((targetIndex + 0.5) / emptyCells(afterClear).length, 0.999, 0.999);

      const result = applyMove(state(board, [3, 4, 5]), cell(1, 4), cell(0, 4), steer);

      expect(emptyBefore).toBe(72);
      expect(result.spawned[0]).toEqual(cell(4, 8));
      expect(result.cleared).toHaveLength(10);
      expect(sortCells(result.cleared)).toEqual(
        sortCells([
          ...[0, 1, 2, 3, 4].map((col) => cell(0, col)),
          ...[1, 2, 3, 4, 5].map((row) => cell(row, 8)),
        ]),
      );
      expect(result.score).toBe(10);
    });

    it('should also clear a line completed by a newly spawned ball', () => {
      // Row 0 has four 3s and one gap at (0,4). The only other empty cells do not exist:
      // fill the rest so the spawn can only land on (0,4)... except the moved ball's origin.
      const board = boardOf(
        '3333.',
        ...Array.from({ length: 8 }, (_, row) => (row === 7 ? '12121212.' : '121212121')),
      );
      // Fill the right part of row 0 too, leaving exactly (0,4) and (8,8) empty.
      [5, 6, 7, 8].forEach((col) => (board[0][col] = 1 + (col % 2)));
      // Move (8,7) → (8,8): no line. Empty cells are then (0,4) and (8,7).
      const before = state(board, [3, 4, 5]);

      const result = applyMove(before, cell(8, 7), cell(8, 8), sequence(0));

      expect(result.spawned[0]).toEqual(cell(0, 4)); // rng 0 → first empty cell, colour 3
      expect(sortCells(result.cleared)).toEqual([0, 1, 2, 3, 4].map((col) => cell(0, col)));
      expect(result.score).toBe(5);
    });

    it('should end the game when the board is full after spawning', () => {
      const board = boardOf(...Array.from({ length: 9 }, () => '121212121'));
      board[8][8] = 0;
      board[8][7] = 0;
      board[8][6] = 0;
      board[8][5] = 3;
      // Three empty cells after the move: (8,5), (8,6), (8,7) get the three spawned balls.
      const before = state(board, [4, 5, 4]);

      const result = applyMove(before, cell(8, 5), cell(8, 8), sequence(0));

      expect(result.spawned).toHaveLength(3);
      expect(emptyCells(result.board)).toEqual([]);
      expect(result.isOver).toBe(true);
    });

    it('should spawn only as many balls as fit when fewer than 3 cells are empty', () => {
      const board = boardOf(...Array.from({ length: 9 }, () => '121212121'));
      board[8][8] = 0;
      board[8][7] = 3;

      const result = applyMove(state(board, [4, 5, 4]), cell(8, 7), cell(8, 8), sequence(0));

      expect(result.spawned).toEqual([cell(8, 7)]);
      expect(result.isOver).toBe(true);
    });

    it.each([
      ['there is no ball on the origin', cell(5, 5), cell(6, 6), 'Ô được chọn không có bóng'],
      ['the target is the origin', cell(0, 0), cell(0, 0), 'Ô đích phải khác ô xuất phát'],
      ['the target is occupied', cell(0, 0), cell(0, 1), 'Ô đích đã có bóng'],
      ['no path reaches the target', cell(0, 0), cell(5, 5), 'Không có đường đi tới ô này'],
    ])('should throw GameRuleError when %s', (_case, from, to, message) => {
      const before = state(boardOf('12', '2.'));

      expect(() => applyMove(before, from, to)).toThrow(new GameRuleError(message));
    });

    it('should throw GameRuleError when the board is already full', () => {
      const full = boardOf(...Array.from({ length: 9 }, () => '121212121'));

      expect(() => applyMove(state(full), cell(0, 0), cell(0, 1))).toThrow(
        new GameRuleError('Ván chơi đã kết thúc, hãy bắt đầu ván mới'),
      );
    });
  });

  describe('pickHint', () => {
    it('should suggest a move that applyMove accepts', () => {
      for (let round = 0; round < 50; round += 1) {
        const game = createGame();

        const hint = pickHint(game.board);

        expect(hint).not.toBeNull();
        if (hint) expect(() => applyMove(game, hint.from, hint.to)).not.toThrow();
      }
    });

    it('should skip balls that cannot move', () => {
      // (0,0) is walled in; only the ball at (0,1) or (1,0) can move.
      const board = boardOf('12', '2.');

      for (const rng of [sequence(0), sequence(0.5), sequence(0.99)]) {
        const hint = pickHint(board, rng);

        expect(hint?.from).not.toEqual(cell(0, 0));
        expect(hint && findPath(board, hint.from, hint.to)).not.toBeNull();
      }
    });

    it('should return null when no ball can move', () => {
      expect(pickHint(createEmptyBoard())).toBeNull();
      expect(pickHint(boardOf(...Array.from({ length: 9 }, () => '121212121')))).toBeNull();
    });
  });
});
