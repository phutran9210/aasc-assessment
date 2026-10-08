import { nowMs, sleep } from '@common/utils/index.js';

import { Injectable } from '@nestjs/common';

import { SHEETS_RATE_LIMIT } from '../constants/index.js';
import type { SheetsRequestKind } from '../constants/index.js';

/**
 * Client-side sliding window: at most PER_MINUTE read and PER_MINUTE write requests in any
 * 60-second window. A request beyond that waits until the oldest one leaves the window, instead
 * of being sent and answered with 429. The state is per process.
 */
@Injectable()
export class SheetsRateLimiter {
  private readonly sent: Record<SheetsRequestKind, number[]> = { read: [], write: [] };

  /** Resolves when the caller may send one request of this kind. */
  async acquire(kind: SheetsRequestKind): Promise<void> {
    for (;;) {
      const now = nowMs();
      const recent = this.sent[kind].filter((at) => now - at < SHEETS_RATE_LIMIT.WINDOW_MS);
      this.sent[kind] = recent;
      if (recent.length < SHEETS_RATE_LIMIT.PER_MINUTE) {
        recent.push(now);
        return;
      }
      await sleep(recent[0] + SHEETS_RATE_LIMIT.WINDOW_MS - now);
    }
  }
}
