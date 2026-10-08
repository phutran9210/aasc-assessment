import { ConflictException } from '@nestjs/common';

import { WebhookEventRepository } from '../repositories/webhook-event.repository.js';

describe('WebhookEventRepository', () => {
  const input = {
    provider: 'tiktok' as const,
    providerMode: 'mock',
    scopeKey: 'advertiser-1',
    advertiserId: 'advertiser-1',
    eventKey: 'event-1',
    eventType: 'lead.generate',
    rawBody: Buffer.from('payload'),
    payload: { event_id: 'event-1' },
    payloadHash: 'a'.repeat(64),
  };

  function setup(payloadHash: string) {
    const query = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: [] }),
    };
    const findOne = jest.fn().mockResolvedValue({ id: 'stored-event', payloadHash });
    const tx = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
      getRepository: jest.fn().mockReturnValue({ findOne }),
    };
    return { query, tx: tx as never };
  }

  it('returns a duplicate only when the scoped event key has the same payload hash', async () => {
    const { tx } = setup(input.payloadHash);
    const repository = new WebhookEventRepository();

    await expect(repository.accept(input, tx)).resolves.toEqual({
      eventId: 'stored-event',
      duplicate: true,
    });
  });

  it('rejects a reused event key with a different payload hash', async () => {
    const { tx } = setup('b'.repeat(64));
    const repository = new WebhookEventRepository();

    await expect(repository.accept(input, tx)).rejects.toThrow(ConflictException);
  });
});
