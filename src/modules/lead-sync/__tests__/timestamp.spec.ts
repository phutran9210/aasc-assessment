import { formatTimestamp } from '../domain/timestamp.js';

describe('formatTimestamp', () => {
  afterEach(() => jest.useRealTimers());

  it('should render the current moment in the given time zone as yyyy-MM-dd HH:mm:ss', () => {
    jest.useFakeTimers({ now: new Date('2026-10-08T18:30:05.789Z') });

    expect(formatTimestamp('Asia/Ho_Chi_Minh')).toBe('2026-10-09 01:30:05');
    expect(formatTimestamp('UTC')).toBe('2026-10-08 18:30:05');
  });
});
