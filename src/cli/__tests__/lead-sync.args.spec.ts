import { parseSyncArgs } from '../lead-sync.args.js';

describe('parseSyncArgs', () => {
  it('should default both flags to false', () => {
    expect(parseSyncArgs([])).toEqual({ dryRun: false, force: false });
  });

  it('should read the flags in any order', () => {
    expect(parseSyncArgs(['--force', '--dry-run'])).toEqual({ dryRun: true, force: true });
    expect(parseSyncArgs(['--dry-run'])).toEqual({ dryRun: true, force: false });
  });

  it('should refuse an unknown argument instead of ignoring it', () => {
    expect(() => parseSyncArgs(['--dryrun'])).toThrow(
      'Tham số không hợp lệ: --dryrun. Dùng: pnpm sync:leads [--dry-run] [--force]',
    );
  });
});
