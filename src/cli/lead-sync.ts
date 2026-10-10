/**
 * CLI entry point: runs one Google Sheets → Bitrix24 lead sync and waits for it to finish.
 *
 * Usage: `pnpm sync:leads [--dry-run] [--force]`
 * In Docker: `docker compose run --rm app node dist/cli/lead-sync.js`
 * Exit code 1 when the run ends `failed` or `aborted`, or cannot start.
 */
import { SyncRunner } from '@modules/lead-sync/index.js';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { parseSyncArgs } from './lead-sync.args.js';

export async function runLeadSyncCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseSyncArgs(argv);

  // Reuses the app's own configuration and database, so the run shows up in the same run log
  // and shares the single-run lock with the server. No HTTP server and no schedule are started.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  app.enableShutdownHooks();
  try {
    const { run, done } = await app.get(SyncRunner).start({ trigger: 'cli', ...args });
    console.log(`Lead sync ${run.id} đang chạy${args.dryRun ? ' (dry run)' : ''}...`);

    const finished = await done;
    console.table({
      status: finished.status,
      total: finished.total,
      created: finished.created,
      updated: finished.updated,
      skipped: finished.skipped,
      failed: finished.failed,
    });
    if (finished.stopReason) console.log(`Lý do dừng: ${finished.stopReason}`);
    if (finished.status === 'failed' || finished.status === 'aborted') process.exitCode = 1;
  } finally {
    await app.close();
  }
}

if (process.argv[1]?.endsWith('/lead-sync.js')) {
  void runLeadSyncCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
