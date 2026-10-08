import { parseSeedArgs } from '../lead-sheet-seed.args.js';

describe('parseSeedArgs', () => {
  it('should seed 100 rows by default and the given number otherwise', () => {
    expect(parseSeedArgs([])).toEqual({ clear: false, count: 100 });
    expect(parseSeedArgs(['500'])).toEqual({ clear: false, count: 500 });
  });

  it('should read --clear', () => {
    expect(parseSeedArgs(['--clear'])).toMatchObject({ clear: true });
  });

  it.each([['0'], ['5001'], ['12a'], ['--force'], ['-5']])('should reject %j', (argument) => {
    expect(() => parseSeedArgs([argument])).toThrow(/Tham số không hợp lệ/);
  });

  it('should reject a count together with --clear', () => {
    expect(() => parseSeedArgs(['--clear', '50'])).toThrow(/Tham số không hợp lệ/);
  });
});
