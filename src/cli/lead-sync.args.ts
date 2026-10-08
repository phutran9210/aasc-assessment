export type SyncArgs = { dryRun: boolean; force: boolean };

const FLAGS: Record<string, keyof SyncArgs> = { '--dry-run': 'dryRun', '--force': 'force' };

/** Parses the arguments of `pnpm sync:leads`. A typo must fail, not silently run a real sync. */
export function parseSyncArgs(argv: string[]): SyncArgs {
  const args: SyncArgs = { dryRun: false, force: false };
  for (const argument of argv) {
    const flag = FLAGS[argument];
    if (!flag) {
      throw new Error(
        `Tham số không hợp lệ: ${argument}. Dùng: pnpm sync:leads [--dry-run] [--force]`,
      );
    }
    args[flag] = true;
  }
  return args;
}
