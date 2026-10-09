import { BadRequestException } from '@nestjs/common';

import { resolvePeriod } from '../domain/report-period.js';

const now = '2026-10-09T05:30:00.000Z';

describe('report period', () => {
  it('counts 23 hours on the New York spring-forward day and 25 on the fall-back day', () => {
    const spring = resolvePeriod(
      { from: '2026-03-08', to: '2026-03-09', timezone: 'America/New_York' },
      'daily',
      now,
    );
    const fall = resolvePeriod(
      { from: '2026-11-01', to: '2026-11-02', timezone: 'America/New_York' },
      'daily',
      now,
    );

    expect(spring).toMatchObject({
      from: '2026-03-08T05:00:00.000Z',
      to: '2026-03-09T04:00:00.000Z',
      days: [{ date: '2026-03-08', hours: 23 }],
    });
    expect(fall).toMatchObject({
      from: '2026-11-01T04:00:00.000Z',
      to: '2026-11-02T05:00:00.000Z',
      days: [{ date: '2026-11-01', hours: 25 }],
    });
  });

  it('accepts instants that fall exactly on day boundaries of the timezone', () => {
    const period = resolvePeriod(
      {
        from: '2026-03-07T05:00:00Z',
        to: '2026-03-09T04:00:00Z',
        timezone: 'America/New_York',
      },
      'daily',
      now,
    );

    expect(period.days.map((day) => day.date)).toEqual(['2026-03-07', '2026-03-08']);
    expect(period.fromDate).toBe('2026-03-07');
    expect(period.toDate).toBe('2026-03-09');
  });

  it('rejects an unknown timezone with 400', () => {
    expect(() => resolvePeriod({ timezone: 'Mars/Olympus_Mons' }, 'cohort', now)).toThrow(
      BadRequestException,
    );
  });

  it('rejects a daily request that does not align with day boundaries', () => {
    expect(() =>
      resolvePeriod(
        {
          from: '2026-10-01T00:00:00+07:00',
          to: '2026-10-02T06:00:00+07:00',
          timezone: 'Asia/Ho_Chi_Minh',
        },
        'daily',
        now,
      ),
    ).toThrow(BadRequestException);
  });

  it('defaults a daily request to the 30 complete days before today in the timezone', () => {
    const period = resolvePeriod({ timezone: 'Asia/Ho_Chi_Minh' }, 'daily', now);

    expect(period.from).toBe('2026-09-08T17:00:00.000Z');
    expect(period.to).toBe('2026-10-08T17:00:00.000Z');
    expect(period.days).toHaveLength(30);
    expect(period.days.at(0)?.date).toBe('2026-09-09');
    expect(period.days.at(-1)?.date).toBe('2026-10-08');
  });

  it('defaults a cohort request to 30 days ending at the request time', () => {
    const period = resolvePeriod({}, 'cohort', now);

    expect(period).toMatchObject({
      from: '2026-09-09T05:30:00.000Z',
      to: now,
      timezone: 'Asia/Ho_Chi_Minh',
      days: [],
    });
  });

  it('allows arbitrary instants for cohort requests', () => {
    const period = resolvePeriod(
      { from: '2026-10-01T03:15:00Z', to: '2026-10-02T09:45:00Z' },
      'cohort',
      now,
    );

    expect(period.from).toBe('2026-10-01T03:15:00.000Z');
    expect(period.to).toBe('2026-10-02T09:45:00.000Z');
  });

  it('treats date_range as an alias and rejects mixing it with from/to', () => {
    expect(resolvePeriod({ dateRange: '7d' }, 'daily', now).days).toHaveLength(7);
    expect(() =>
      resolvePeriod({ dateRange: '30d', from: '2026-10-01', to: '2026-10-02' }, 'daily', now),
    ).toThrow(BadRequestException);
    expect(() => resolvePeriod({ dateRange: 'last-month' }, 'daily', now)).toThrow(
      BadRequestException,
    );
  });

  it.each([
    [{ from: '2026-10-01' }],
    [{ to: '2026-10-01' }],
    [{ from: '2026-10-02', to: '2026-10-02' }],
    [{ from: '2026-10-03', to: '2026-10-02' }],
    [{ from: '2026-10-01T00:00:00', to: '2026-10-02T00:00:00' }],
    [{ from: 'yesterday', to: '2026-10-02' }],
    [{ from: '2024-01-01', to: '2026-01-01' }],
  ])('rejects the malformed range %j', (query) => {
    expect(() => resolvePeriod(query, 'daily', now)).toThrow(BadRequestException);
  });
});
