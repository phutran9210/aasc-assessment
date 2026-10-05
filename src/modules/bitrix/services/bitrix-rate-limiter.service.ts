import { nowMs } from '@common/utils/index.js';

import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { BITRIX_RATE_LIMIT } from '../constants/index.js';
import { BITRIX_MESSAGES } from '../messages/index.js';

/**
 * Client-side mirror of the Bitrix24 leaky bucket (a counter that grows by one per request and
 * drains at a fixed rate). Calls beyond the burst wait for a free slot instead of being sent and
 * rejected with QUERY_LIMIT_EXCEEDED; calls that would wait too long are refused right away.
 *
 * The state is per process. Several processes behind one IP share the Bitrix24 bucket, so the
 * retry in BitrixApiService stays as the safety net.
 */
@Injectable()
export class BitrixRateLimiter {
  private level = 0;
  private updatedAt = nowMs();

  /** Resolves when the caller may send one request. Rejects with 429 if the queue is too long. */
  async acquire(): Promise<void> {
    this.drain();
    const overflow = this.level + 1 - BITRIX_RATE_LIMIT.BURST;
    const waitMs = overflow > 0 ? (overflow / BITRIX_RATE_LIMIT.DRAIN_PER_SECOND) * 1000 : 0;
    if (waitMs > BITRIX_RATE_LIMIT.MAX_WAIT_MS) {
      throw new HttpException(BITRIX_MESSAGES.ERROR.RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS);
    }
    // Reserve the slot now so later callers queue up behind this one.
    this.level += 1;
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  /** Bitrix24 reported the limit: treat the bucket as full so the next calls slow down. */
  saturate(): void {
    this.drain();
    this.level = Math.max(this.level, BITRIX_RATE_LIMIT.BURST);
  }

  private drain(): void {
    const now = nowMs();
    const drained = ((now - this.updatedAt) / 1000) * BITRIX_RATE_LIMIT.DRAIN_PER_SECOND;
    this.level = Math.max(0, this.level - drained);
    this.updatedAt = now;
  }
}
