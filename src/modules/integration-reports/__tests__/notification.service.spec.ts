import { Logger } from '@nestjs/common';
import {
  NotificationService,
  ConversionNotificationListener,
  OPERATOR_AUDIENCE,
} from '../services/notification.service.js';

const input = { dedupKey: 'fact-1', type: 'report.ready', payload: { reportId: 'r1' } };
const notification = {
  id: 'notification-1',
  type: 'report.ready',
  status: 'pending',
  dedupKey: 'fact-1',
  payload: { reportId: 'r1', channels: ['in_app', 'operational_log'] },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  sentAt: null,
};

function setup(
  options: { created?: boolean; found?: typeof notification | null; bitrixEnabled?: boolean } = {},
) {
  const notifications = {
    insertOnce: jest
      .fn()
      .mockResolvedValue({ id: 'notification-1', created: options.created ?? true }),
    findById: jest
      .fn()
      .mockResolvedValue(options.found === undefined ? notification : options.found),
    markSent: jest.fn().mockResolvedValue(undefined),
    listFor: jest.fn().mockResolvedValue([[notification], 1]),
  };
  const operations = { ensure: jest.fn().mockResolvedValue({ id: 'operation-1' }) };
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const dataSource = { transaction: jest.fn((work) => work({})) };
  const bitrix = {
    isEnabled: jest.fn().mockResolvedValue(options.bitrixEnabled ?? false),
    notify: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new NotificationService(
      dataSource as never,
      notifications as never,
      operations as never,
      outbox as never,
      bitrix,
    ),
    notifications,
    operations,
    outbox,
    dataSource,
    bitrix,
  };
}

describe('NotificationService', () => {
  it('deduplicates notifications, queues only new records and applies the default audience', async () => {
    const state = setup();
    await expect(state.service.ensure(input, {} as never)).resolves.toBe('notification-1');
    expect(state.notifications.insertOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: null,
        channel: 'in_app',
        status: 'pending',
        payload: {
          reportId: 'r1',
          audience: OPERATOR_AUDIENCE,
          channels: ['in_app', 'operational_log'],
        },
      }),
      {},
    );
    expect(state.operations.ensure).toHaveBeenCalledTimes(1);
    expect(state.outbox.append).toHaveBeenCalledTimes(1);
    state.notifications.insertOnce.mockResolvedValueOnce({ id: 'notification-1', created: false });
    await expect(
      state.service.ensureOnce(
        { ...input, recipientId: 'user-1', audience: ['integration_admin'], channels: ['bitrix'] },
        {} as never,
      ),
    ).resolves.toEqual({ id: 'notification-1', created: false });
    expect(state.notifications.insertOnce).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recipientId: 'user-1',
        payload: { reportId: 'r1', audience: [], channels: ['bitrix'] },
      }),
      {},
    );
    expect(state.outbox.append).toHaveBeenCalledTimes(1);
  });

  it('delivers selected channels, skips missing and sent rows, and lists read timestamps', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const state = setup({
      bitrixEnabled: true,
      found: {
        ...notification,
        payload: { ...notification.payload, channels: ['in_app', 'operational_log', 'bitrix'] },
      },
    });
    await expect(state.service.deliver('notification-1')).resolves.toBe(true);
    expect(state.bitrix.notify).toHaveBeenCalledWith({
      type: 'report.ready',
      payload: expect.objectContaining({ reportId: 'r1' }),
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('integration.notification'));
    expect(state.notifications.markSent).toHaveBeenCalledWith('notification-1', expect.any(Date));
    state.notifications.findById.mockResolvedValueOnce(null);
    await expect(state.service.deliver('missing')).resolves.toBe(false);
    state.notifications.findById.mockResolvedValueOnce({ ...notification, status: 'sent' });
    await expect(state.service.deliver('sent')).resolves.toBe(true);
    const listed = await state.service.list(
      { sub: 'user-1', roles: ['integration_operator'] } as never,
      2,
      10,
    );
    expect(listed).toMatchObject({ total: 1, items: [{ id: 'notification-1', sentAt: null }] });
  });

  it('delivers inline without queueing and forwards only non-lead-qualified conversion milestones', async () => {
    const state = setup();
    await state.service.deliverSystem(input);
    expect(state.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(state.operations.ensure).not.toHaveBeenCalled();
    const notifications = { ensure: jest.fn().mockResolvedValue('id') };
    const feedback = { schedule: jest.fn().mockResolvedValue(undefined) };
    const listener = new ConversionNotificationListener(notifications, feedback);
    await listener.schedule('lead-1', 'lead_qualified', {} as never);
    await listener.schedule('lead-1', 'deal_created', {} as never);
    expect(feedback.schedule).toHaveBeenCalledTimes(2);
    expect(notifications.ensure).toHaveBeenCalledTimes(1);
    expect(notifications.ensure).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'conversion/lead-1/deal_created' }),
      {},
    );
  });
});
