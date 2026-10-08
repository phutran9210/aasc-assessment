import { ServiceUnavailableException } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { TiktokInboxService } from '../services/tiktok-inbox.service.js';
import type { TiktokAppConfig } from '@config/tiktok-app/env.validation.js';

describe('TiktokInboxService', () => {
  const event = {
    eventId: 'event-1',
    eventType: 'lead.generate',
    advertiserId: 'advertiser-1',
    occurredAt: new Date('2026-10-09T00:00:00.000Z'),
    payload: { campaign_id: 'campaign-1' },
  };

  it('rejects a missing raw body before opening a transaction', async () => {
    const { dataSource, service } = createService();

    await expect(service.receive({} as never, undefined)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('returns a duplicate receipt without creating another operation or outbox row', async () => {
    const { service, events, operations, outbox } = createService();
    events.accept.mockResolvedValue({ eventId: 'stored-event', duplicate: true });
    const raw = Buffer.from('signed event');

    await expect(service.receive(event, raw)).resolves.toEqual({
      received: true,
      eventId: 'stored-event',
      duplicate: true,
    });

    expect(events.accept).toHaveBeenCalledWith(
      expect.objectContaining({ payloadHash: createHash('sha256').update(raw).digest('hex') }),
      expect.any(Object),
    );
    expect(operations.ensure).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('propagates a conflicting duplicate event key without enqueueing work', async () => {
    const { service, events, operations, outbox } = createService();
    events.accept.mockRejectedValue(
      new ConflictException('Webhook event key was reused with a different payload'),
    );

    await expect(service.receive(event, Buffer.from('changed event'))).rejects.toThrow(
      ConflictException,
    );

    expect(operations.ensure).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('marks authenticated unsupported events ignored without creating queued work', async () => {
    const { service, events, operations, outbox, updateEvent } = createService();
    events.accept.mockResolvedValue({ eventId: 'stored-event', duplicate: false });

    await expect(
      service.receive({ ...event, eventType: 'advertiser.update' }, Buffer.from('event')),
    ).resolves.toMatchObject({ received: true, duplicate: false });

    expect(updateEvent).toHaveBeenCalledWith('stored-event', { status: 'ignored' });
    expect(operations.ensure).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('captures the current configuration revisions through its repository boundary', async () => {
    const { service, events, operations } = createService();
    events.accept.mockResolvedValue({ eventId: 'stored-event', duplicate: false });

    await service.receive(event, Buffer.from('event'));

    expect(operations.ensure).toHaveBeenCalledWith(
      expect.objectContaining({
        configRevisions: { mapping: 2, rules: 4, scoring: 0 },
      }),
      expect.any(Object),
    );
  });
});

function createService() {
  const events = { accept: jest.fn(), findById: jest.fn(), updateStatus: jest.fn() };
  const operations = {
    findById: jest.fn(),
    findByKey: jest.fn(),
    ensure: jest.fn().mockResolvedValue({ id: 'operation-1' }),
  };
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const configurations = {
    revisions: jest.fn().mockResolvedValue({ mapping: 2, rules: 4 }),
  };
  const updateEvent = jest.fn().mockResolvedValue(undefined);
  const tx = { getRepository: jest.fn().mockReturnValue({ update: updateEvent, find: jest.fn() }) };
  const dataSource = {
    transaction: jest.fn((callback: (manager: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as DataSource;
  const service = new TiktokInboxService(dataSource, events, operations, outbox, configurations, {
    advertiserId: 'advertiser-1',
    tiktokMode: 'mock',
  } as unknown as TiktokAppConfig);
  return { configurations, dataSource, events, operations, outbox, service, updateEvent };
}
