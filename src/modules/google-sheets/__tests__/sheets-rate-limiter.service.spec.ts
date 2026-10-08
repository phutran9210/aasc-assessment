import { SheetsRateLimiter } from '../services/sheets-rate-limiter.service.js';

describe('SheetsRateLimiter', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('should let 50 requests of one kind through at once and hold the 51st for a minute', async () => {
    const limiter = new SheetsRateLimiter();
    for (let index = 0; index < 50; index++) await limiter.acquire('read');

    const waiting = jest.fn();
    void limiter.acquire('read').then(waiting);

    await jest.advanceTimersByTimeAsync(59_000);
    expect(waiting).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1_500);
    expect(waiting).toHaveBeenCalled();
  });

  it('should count reads and writes separately', async () => {
    const limiter = new SheetsRateLimiter();
    for (let index = 0; index < 50; index++) await limiter.acquire('read');

    const write = jest.fn();
    void limiter.acquire('write').then(write);
    await jest.advanceTimersByTimeAsync(0);

    expect(write).toHaveBeenCalled();
  });
});
