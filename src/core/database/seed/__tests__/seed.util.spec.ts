import { DEFAULT_SEED_COUNT, MAX_SEED_COUNT, parseSeedCount } from '../seed.util.js';

describe('parseSeedCount', () => {
  it('should return the default when no argument is given', () => {
    expect(parseSeedCount(undefined)).toBe(DEFAULT_SEED_COUNT);
    expect(DEFAULT_SEED_COUNT).toBe(100);
  });

  it.each([
    ['1', 1],
    ['250', 250],
    [String(MAX_SEED_COUNT), MAX_SEED_COUNT],
  ])('should return the number when the argument is "%s"', (argument, expected) => {
    expect(parseSeedCount(argument)).toBe(expected);
  });

  it.each(['0', '-5', '1.5', 'abc', '', '10abc', String(MAX_SEED_COUNT + 1)])(
    'should throw a readable error when the argument is "%s"',
    (argument) => {
      expect(() => parseSeedCount(argument)).toThrow(
        `Số lượng seed phải là số nguyên từ 1 đến ${MAX_SEED_COUNT}`,
      );
    },
  );
});
