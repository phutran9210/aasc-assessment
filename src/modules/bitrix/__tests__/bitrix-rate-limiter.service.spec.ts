import { BITRIX_RATE_LIMIT } from '../constants/index.js';
import { BitrixRateLimiter } from '../services/bitrix-rate-limiter.service.js';

describe('BitrixRateLimiter', () => {
  let limiter: BitrixRateLimiter;

  beforeEach(() => {
    jest.useFakeTimers();
    limiter = new BitrixRateLimiter();
  });

  afterEach(() => jest.useRealTimers());

  /** Resolves to true once `promise` settles within `ms` of fake time. */
  const settlesWithin = async (promise: Promise<void>, ms: number): Promise<boolean> => {
    let settled = false;
    void promise.then(() => (settled = true));
    await jest.advanceTimersByTimeAsync(ms);
    return settled;
  };

  const fill = async (): Promise<void> => {
    for (let i = 0; i < BITRIX_RATE_LIMIT.BURST; i++) await limiter.acquire();
  };

  it('should let a burst through without waiting', async () => {
    await expect(settlesWithin(fill(), 0)).resolves.toBe(true);
  });

  it('should hold the next call until the bucket has drained one slot', async () => {
    await fill();
    const next = limiter.acquire();

    const slotMs = 1000 / BITRIX_RATE_LIMIT.DRAIN_PER_SECOND;
    await expect(settlesWithin(next, slotMs - 1)).resolves.toBe(false);
    await expect(settlesWithin(next, 1)).resolves.toBe(true);
  });

  it('should refuse with 429 instead of queueing longer than the maximum wait', async () => {
    await fill();
    const queued = (BITRIX_RATE_LIMIT.MAX_WAIT_MS / 1000) * BITRIX_RATE_LIMIT.DRAIN_PER_SECOND;
    const waiting = Array.from({ length: queued }, () => limiter.acquire());

    await expect(limiter.acquire()).rejects.toMatchObject({ status: 429 });

    await jest.advanceTimersByTimeAsync(BITRIX_RATE_LIMIT.MAX_WAIT_MS);
    await expect(Promise.all(waiting)).resolves.toHaveLength(queued);
  });

  it('should make callers wait after Bitrix24 itself reports the limit', async () => {
    limiter.saturate();

    await expect(settlesWithin(limiter.acquire(), 0)).resolves.toBe(false);
  });
});
