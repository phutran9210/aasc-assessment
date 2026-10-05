/**
 * Verifies F(10), F(20), F(50) and measures the execution time of F(50).
 *
 * Usage: node scripts/fibonacci/benchmark.js
 */
import { performance } from 'node:perf_hooks';

import { fibonacci, fibonacciTabulation } from './fibonacci.js';

const RUNS = 10;
const TARGET = 50;
const LIMIT_MS = 1;
const EXPECTED = new Map([
  [10, 55n],
  [20, 6765n],
  [50, 12586269025n],
]);

/** Prints PASS/FAIL for each known value and returns true when all match. */
function verify(implementation) {
  let allCorrect = true;
  for (const [n, expected] of EXPECTED) {
    const actual = implementation(n);
    const correct = actual === expected;
    allCorrect &&= correct;
    console.log(`  F(${n}) = ${actual} ${correct ? 'PASS' : `FAIL (mong đợi ${expected})`}`);
  }
  return allCorrect;
}

/**
 * Runs F(TARGET) `RUNS` times. Each run is shown with console.time/console.timeEnd as the brief
 * asks; the average uses performance.now() because console.timeEnd only prints, it returns nothing.
 */
function measure(name, implementation) {
  const durations = [];
  for (let run = 1; run <= RUNS; run += 1) {
    const label = `  ${name} F(${TARGET}) lần ${run}`;
    console.time(label);
    const startedAt = performance.now();
    implementation(TARGET);
    durations.push(performance.now() - startedAt);
    console.timeEnd(label);
  }

  const average = durations.reduce((sum, value) => sum + value, 0) / RUNS;
  const slowest = Math.max(...durations);
  console.log(`  => trung bình ${average.toFixed(6)} ms, chậm nhất ${slowest.toFixed(6)} ms`);
  return average;
}

let success = true;
for (const [name, implementation] of [
  ['fibonacci', fibonacci],
  ['fibonacciTabulation', fibonacciTabulation],
]) {
  console.log(`\n${name}`);
  success = verify(implementation) && success;

  const average = measure(name, implementation);
  const fastEnough = average < LIMIT_MS;
  console.log(`  => ${fastEnough ? 'ĐẠT' : 'KHÔNG ĐẠT'} yêu cầu trung bình < ${LIMIT_MS} ms`);
  success = fastEnough && success;
}

process.exitCode = success ? 0 : 1;
