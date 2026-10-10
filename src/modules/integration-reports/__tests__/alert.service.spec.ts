import { AlertService } from '../services/alert.service.js';

describe('AlertService', () => {
  function setup() {
    const query = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      getCount: jest.fn(),
      getRawOne: jest.fn(),
    };
    const manager = {
      query: jest.fn().mockResolvedValue(undefined),
      getRepository: jest.fn(() => ({ createQueryBuilder: jest.fn(() => query) })),
    };
    const dataSource = {
      manager,
      transaction: jest.fn((fn: (tx: typeof manager) => Promise<unknown>) => fn(manager)),
    };
    const notifications = { ensureOnce: jest.fn().mockResolvedValue({ created: true }) };
    const notificationRows = { latestOfTypes: jest.fn() };
    return {
      service: new AlertService(
        dataSource as never,
        notifications as never,
        notificationRows as never,
        { advertiserId: 'adv-1' },
      ),
      query,
      notifications,
      notificationRows,
      manager,
    };
  }

  it('announces active dead-letter, backlog, auth, and high failure-rate conditions once', async () => {
    const { service, query, notifications } = setup();
    query.getCount.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    query.getRawOne
      .mockResolvedValueOnce({ oldest: new Date('2026-01-01T00:00:00Z') })
      .mockResolvedValueOnce({ failed: '2', succeeded: '18' });
    const summary = await service.evaluate('2026-01-02T00:00:00Z');
    expect(summary.fired).toEqual([
      'dead_letter',
      'pending_backlog',
      'upstream_auth',
      'failure_rate',
    ]);
    expect(summary.active).toEqual(summary.fired);
    expect(notifications.ensureOnce).toHaveBeenCalledTimes(4);
    expect(notifications.ensureOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupKey: expect.stringContaining('adv-1'),
        payload: expect.objectContaining({ scope: 'adv-1' }),
      }),
      expect.anything(),
    );
  });

  it('announces recovery only when the latest notification is the firing alert', async () => {
    const { service, query, notifications, notificationRows } = setup();
    query.getCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    query.getRawOne
      .mockResolvedValueOnce({ oldest: null })
      .mockResolvedValueOnce({ failed: '0', succeeded: '10' });
    notificationRows.latestOfTypes
      .mockResolvedValueOnce({ id: 'n1', type: 'alert.dead_letter' })
      .mockResolvedValueOnce({ id: 'n2', type: 'alert.pending_backlog.recovered' })
      .mockResolvedValueOnce({ id: 'n3', type: 'alert.upstream_auth' })
      .mockResolvedValueOnce(null);
    notifications.ensureOnce
      .mockResolvedValueOnce({ created: true })
      .mockResolvedValueOnce({ created: false });
    const summary = await service.evaluate('2026-01-02T00:00:00Z');
    expect(summary).toEqual({ fired: [], active: [], recovered: ['dead_letter'] });
    expect(notificationRows.latestOfTypes).toHaveBeenCalledTimes(4);
    expect(notifications.ensureOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupKey: 'alert-recovered/n1',
        type: 'alert.dead_letter.recovered',
      }),
      expect.anything(),
    );
  });

  it('does not mark low sample sizes or exactly-threshold failure rates active', async () => {
    const { service, query } = setup();
    query.getCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    query.getRawOne
      .mockResolvedValueOnce({ oldest: null })
      .mockResolvedValueOnce({ failed: '1', succeeded: '19' });
    await expect(service.evaluate('2026-01-02T00:00:00Z')).resolves.toEqual({
      fired: [],
      recovered: [],
      active: [],
    });
  });
});
