import { LeadSyncHandler } from '../workers/lead-sync.handler.js';
import type { OperationContext } from '@core/queue/types/worker.types.js';

describe('LeadSyncHandler', () => {
  it('requests auto-conversion after a successful Lead sync', async () => {
    const dataSource = {
      getRepository: () => ({
        findOne: jest.fn().mockResolvedValue({
          payload: { leadId: 'lead-1' },
          targetVersion: 3,
        }),
      }),
    };
    const sync = { sync: jest.fn().mockResolvedValue({ outcome: 'succeeded' }) };
    const conversion = { request: jest.fn().mockResolvedValue(null) };
    const handler = new LeadSyncHandler(dataSource as never, sync as never, conversion as never);

    await expect(
      handler.handle({ operationId: 'operation-1' } as OperationContext),
    ).resolves.toEqual({
      outcome: 'succeeded',
    });
    expect(conversion.request).toHaveBeenCalledWith('lead-1', 'rule');
  });

  it('does not request auto-conversion when Lead sync has not succeeded', async () => {
    const dataSource = {
      getRepository: () => ({
        findOne: jest.fn().mockResolvedValue({
          payload: { leadId: 'lead-1' },
          targetVersion: 3,
        }),
      }),
    };
    const sync = { sync: jest.fn().mockResolvedValue({ outcome: 'retry_wait' }) };
    const conversion = { request: jest.fn() };
    const handler = new LeadSyncHandler(dataSource as never, sync as never, conversion as never);

    await expect(
      handler.handle({ operationId: 'operation-1' } as OperationContext),
    ).resolves.toMatchObject({
      outcome: 'retry_wait',
    });
    expect(conversion.request).not.toHaveBeenCalled();
  });
});
