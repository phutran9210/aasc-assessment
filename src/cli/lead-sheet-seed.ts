/**
 * CLI entry point: fills the Google Sheet of the lead sync with generated rows, or removes them.
 *
 * Usage: `pnpm seed:leads [count]` appends rows (100 by default) under the last row;
 * `pnpm seed:leads --clear` deletes every seeded row and the Bitrix24 leads linked to them.
 * Seeded rows are recognised by their email domain, so other rows of the Sheet are left alone.
 */
import { appConfig } from '@config/index.js';
import type { AppConfig } from '@config/index.js';
import { LeadSheetSeeder } from '@modules/lead-sync/index.js';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { parseSeedArgs } from './lead-sheet-seed.args.js';

export async function runLeadSheetSeedCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseSeedArgs(argv);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    if (app.get<AppConfig>(appConfig.KEY).isProduction) {
      throw new Error('Không chạy seed khi NODE_ENV=production (seed ghi dữ liệu thử vào Sheet)');
    }
    const seeder = app.get(LeadSheetSeeder);
    if (args.clear) {
      const { rows, leads } = await seeder.clear();
      console.log(
        `Đã xóa ${rows} hàng seed trong Sheet và ${leads} lead tương ứng trong Bitrix24.`,
      );
    } else {
      const { added, firstRow, lastRow } = await seeder.seed(args.count);
      console.log(`Đã thêm ${added} hàng vào Sheet (hàng ${firstRow} đến ${lastRow}).`);
      console.log('Chạy "pnpm sync:leads" để đồng bộ, "pnpm seed:leads --clear" để dọn.');
    }
  } finally {
    await app.close();
  }
}

if (process.argv[1]?.endsWith('/lead-sheet-seed.js')) {
  void runLeadSheetSeedCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
