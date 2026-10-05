import { buildPaginationMeta, toSkip } from '../pagination.util.js';

describe('pagination util', () => {
  describe('buildPaginationMeta', () => {
    it('should round totalPages up when total is not a multiple of limit', () => {
      expect(buildPaginationMeta(101, 2, 20)).toEqual({
        total: 101,
        page: 2,
        limit: 20,
        totalPages: 6,
      });
    });

    it('should return zero totalPages when there are no records', () => {
      expect(buildPaginationMeta(0, 1, 20).totalPages).toBe(0);
    });

    it('should return zero totalPages when limit is zero', () => {
      expect(buildPaginationMeta(10, 1, 0).totalPages).toBe(0);
    });
  });

  describe('toSkip', () => {
    it('should return 0 when page is 1', () => {
      expect(toSkip(1, 20)).toBe(0);
    });

    it('should skip previous pages when page is greater than 1', () => {
      expect(toSkip(3, 20)).toBe(40);
    });
  });
});
