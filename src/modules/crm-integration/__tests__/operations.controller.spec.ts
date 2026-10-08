import { OperationsController } from '../controllers/operations.controller.js';

describe('OperationsController', () => {
  it('delegates retry reasons with the authenticated actor', async () => {
    const reads = { listOperations: jest.fn(), getOperation: jest.fn() };
    const control = {
      retry: jest.fn().mockResolvedValue({ id: 'operation-1' }),
      resolve: jest.fn(),
    };
    const controller = new OperationsController(reads as never, control as never);

    await expect(
      controller.retry('operation-1', { reason: 'upstream recovered' }, {
        user: { sub: 'actor-1' },
      } as never),
    ).resolves.toEqual({ id: 'operation-1' });

    expect(control.retry).toHaveBeenCalledWith('operation-1', 'upstream recovered', {
      sub: 'actor-1',
    });
  });
});
