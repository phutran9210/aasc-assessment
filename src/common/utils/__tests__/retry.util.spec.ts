import { backoffDelayMs, sleep } from '../retry.util.js';

describe('retry.util', () => {
  afterEach(() => jest.restoreAllMocks());

  it('should double the delay on every attempt and add jitter below one base', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    expect([0, 1, 2, 3].map((attempt) => backoffDelayMs(attempt, 500))).toEqual([
      500, 1000, 2000, 4000,
    ]);

    jest.spyOn(Math, 'random').mockReturnValue(0.999);
    expect(backoffDelayMs(2, 500)).toBe(2499);
  });

  it('should not wait at all when the base delay is zero', () => {
    expect(backoffDelayMs(5, 0)).toBe(0);
  });

  it('should resolve sleep after the given time', async () => {
    jest.useFakeTimers();
    const done = jest.fn();
    void sleep(1000).then(done);

    await jest.advanceTimersByTimeAsync(999);
    expect(done).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
