/**
 * Fibonacci numbers with Dynamic Programming and BigInt.
 *
 * F(0) = 0, F(1) = 1, F(n) = F(n - 1) + F(n - 2)
 *
 * BigInt is required because F(79) already exceeds Number.MAX_SAFE_INTEGER (2^53 - 1);
 * with plain numbers large results would silently lose precision.
 */

/**
 * Rejects anything that is not a non-negative integer.
 * @param {unknown} n
 */
function assertValidIndex(n) {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`n phải là số nguyên không âm, nhận được: ${String(n)}`);
  }
}

/**
 * Bottom-up DP keeping only the last two values.
 * Time O(n): one addition per step. Space O(1): two variables, whatever n is.
 *
 * @param {number} n index in the sequence (n >= 0)
 * @returns {bigint} F(n)
 */
export function fibonacci(n) {
  assertValidIndex(n);

  let previous = 0n; // F(i - 1)
  let current = 1n; // F(i)
  if (n === 0) return previous;

  for (let i = 2; i <= n; i += 1) {
    [previous, current] = [current, previous + current];
  }
  return current;
}

/**
 * Bottom-up DP with a table (the classic "tabulation" form).
 * Time O(n). Space O(n): keeps every F(0..n), useful when all values are needed.
 *
 * @param {number} n index in the sequence (n >= 0)
 * @returns {bigint} F(n)
 */
export function fibonacciTabulation(n) {
  assertValidIndex(n);

  const table = [0n, 1n];
  for (let i = 2; i <= n; i += 1) {
    table[i] = table[i - 1] + table[i - 2];
  }
  return table[n];
}
