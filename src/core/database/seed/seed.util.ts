export const DEFAULT_SEED_COUNT = 100;
export const MAX_SEED_COUNT = 10_000;

/**
 * Reads the record count from the command line (`pnpm db:seed 250`).
 * Rejects anything that is not a whole number in range instead of silently seeding a wrong amount.
 */
export function parseSeedCount(argument: string | undefined): number {
  if (argument === undefined) return DEFAULT_SEED_COUNT;

  const count = Number(argument);
  const isValid =
    /^\d+$/.test(argument) && Number.isInteger(count) && count >= 1 && count <= MAX_SEED_COUNT;
  if (!isValid) {
    throw new Error(
      `Số lượng seed phải là số nguyên từ 1 đến ${MAX_SEED_COUNT}, nhận được: "${argument}"`,
    );
  }
  return count;
}
