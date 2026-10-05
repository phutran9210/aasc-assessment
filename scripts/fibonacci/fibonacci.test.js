import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fibonacci, fibonacciTabulation } from './fibonacci.js';

const KNOWN_VALUES = [
  [0, 0n],
  [1, 1n],
  [2, 1n],
  [10, 55n],
  [20, 6765n],
  [50, 12586269025n],
  // Larger than Number.MAX_SAFE_INTEGER: only correct with BigInt.
  [100, 354224848179261915075n],
];

for (const [name, implementation] of [
  ['fibonacci (O(1) space)', fibonacci],
  ['fibonacciTabulation (array)', fibonacciTabulation],
]) {
  describe(name, () => {
    for (const [n, expected] of KNOWN_VALUES) {
      it(`should return ${expected} when n is ${n}`, () => {
        assert.equal(implementation(n), expected);
      });
    }

    it('should return a bigint', () => {
      assert.equal(typeof implementation(50), 'bigint');
    });

    for (const invalid of [-1, 1.5, Number.NaN, '50', null, undefined]) {
      it(`should throw RangeError when n is ${String(invalid)}`, () => {
        assert.throws(() => implementation(invalid), RangeError);
      });
    }
  });
}

describe('both implementations', () => {
  it('should agree for every n from 0 to 200', () => {
    for (let n = 0; n <= 200; n += 1) {
      assert.equal(fibonacci(n), fibonacciTabulation(n));
    }
  });
});
