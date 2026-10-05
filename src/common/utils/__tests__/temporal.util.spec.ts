import { elapsedMs, nowDate, nowIso, nowMs, Temporal } from '@common/utils/index.js';

describe('temporal util', () => {
  describe('Temporal', () => {
    it('should convert an instant between timezones when a zone is given', () => {
      const instant = Temporal.Instant.from('2026-01-01T00:00:00Z');

      expect(instant.toZonedDateTimeISO('Asia/Ho_Chi_Minh').hour).toBe(7);
    });

    it('should compare instants when checking expiry', () => {
      const issuedAt = Temporal.Instant.from('2026-01-01T00:00:00Z');
      const expiresAt = issuedAt.add({ hours: 1 });

      expect(Temporal.Instant.compare(expiresAt, issuedAt)).toBe(1);
      expect(expiresAt.toString()).toBe('2026-01-01T01:00:00Z');
    });

    it('should reject an invalid calendar date when parsing strictly', () => {
      expect(() => Temporal.PlainDate.from('2026-02-30', { overflow: 'reject' })).toThrow(
        RangeError,
      );
    });
  });

  describe('nowIso', () => {
    it('should return a UTC ISO 8601 string with millisecond precision when called', () => {
      expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should return a value that parses back to the current time when called', () => {
      const parsed = Temporal.Instant.from(nowIso());

      expect(Math.abs(elapsedMs(parsed))).toBeLessThan(1000);
    });
  });

  describe('elapsedMs', () => {
    it('should return the milliseconds passed when start is in the past', () => {
      const start = Temporal.Now.instant().subtract({ milliseconds: 1500 });

      const elapsed = elapsedMs(start);

      expect(elapsed).toBeGreaterThanOrEqual(1500);
      expect(elapsed).toBeLessThan(2500);
    });

    it('should return a negative number when start is in the future', () => {
      const start = Temporal.Now.instant().add({ seconds: 10 });

      expect(elapsedMs(start)).toBeLessThan(0);
    });
  });

  describe('nowMs and nowDate', () => {
    afterEach(() => jest.useRealTimers());

    it('should return the current moment as epoch milliseconds', () => {
      jest.useFakeTimers({ now: 1_791_180_000_123 });

      expect(nowMs()).toBe(1_791_180_000_123);
    });

    it('should follow the clock as time passes', () => {
      jest.useFakeTimers({ now: 1_000 });
      jest.advanceTimersByTime(250);

      expect(nowMs()).toBe(1_250);
    });

    it('should return the same moment as a Date for datetime columns', () => {
      jest.useFakeTimers({ now: 1_791_180_000_123 });

      expect(nowDate()).toEqual(new Date(1_791_180_000_123));
    });
  });
});
