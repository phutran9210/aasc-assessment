/** Nearest-rank percentile of an ascending sample; `fraction` is between 0 and 1. */
export function percentile(sorted: readonly number[], fraction: number): number {
  if (!sorted.length) return 0;
  const rank = Math.ceil(sorted.length * fraction);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}
