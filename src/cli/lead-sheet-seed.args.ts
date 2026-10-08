export type SeedArgs = { clear: boolean; count: number };

export const DEFAULT_LEAD_SEED_COUNT = 100;
export const MAX_LEAD_SEED_COUNT = 5000;
const USAGE = 'Dùng: pnpm seed:leads [số hàng] hoặc pnpm seed:leads --clear';

/** Parses the arguments of `pnpm seed:leads`. A typo must fail, not seed a wrong amount. */
export function parseSeedArgs(argv: string[]): SeedArgs {
  const args: SeedArgs = { clear: false, count: DEFAULT_LEAD_SEED_COUNT };
  for (const argument of argv) {
    if (argument === '--clear') {
      args.clear = true;
      continue;
    }
    const count = Number(argument);
    const valid =
      /^\d+$/.test(argument) && count >= 1 && count <= MAX_LEAD_SEED_COUNT && !args.clear;
    if (!valid) {
      throw new Error(
        `Tham số không hợp lệ: ${argument}. Số hàng phải từ 1 đến ${MAX_LEAD_SEED_COUNT}. ${USAGE}`,
      );
    }
    args.count = count;
  }
  return args;
}
