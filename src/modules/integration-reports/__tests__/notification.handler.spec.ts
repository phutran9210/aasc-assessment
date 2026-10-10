import { NotificationHandler } from '../workers/notification.handler.js';

describe('NotificationHandler', () => {
  let operation: Record<string, unknown> | null;
  const deliver = jest.fn();
  const deliverSystem = jest.fn();
  const handlerFor = () =>
    new NotificationHandler(
      { getRepository: jest.fn(() => ({ findOne: jest.fn(() => operation) })) } as never,
      { deliver, deliverSystem } as never,
    );
  const context = (attempt: number) => ({ operationId: 'op-1', attempt });

  beforeEach(() => {
    jest.resetAllMocks();
    operation = { kind: 'integration_notification', payload: {} };
  });

  it('acknowledges dead-letter records and validates notification payloads', async () => {
    operation = null;
    await expect(handlerFor().handle(context(1) as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'NOTIFICATION_PAYLOAD_INVALID',
    });
    operation = { kind: 'integration_dlq', payload: {} };
    await expect(handlerFor().handle(context(1) as never)).resolves.toEqual({
      outcome: 'succeeded',
    });
    operation = { kind: 'integration_notification', payload: {} };
    await expect(handlerFor().handle(context(1) as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'NOTIFICATION_PAYLOAD_INVALID',
    });
  });

  it('delivers a stored notification or quarantines a missing one', async () => {
    operation = { kind: 'integration_notification', payload: { notificationId: 'n1' } };
    deliver.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(handlerFor().handle(context(1) as never)).resolves.toEqual({
      outcome: 'succeeded',
    });
    await expect(handlerFor().handle(context(1) as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'NOTIFICATION_NOT_FOUND',
    });
    expect(deliver).toHaveBeenCalledWith('n1');
  });

  it('sends dead-letter notices with nullable error codes', async () => {
    operation = {
      kind: 'integration_notification',
      payload: { sourceOperationId: 'source-1', errorCode: 'BAD_INPUT' },
    };
    await expect(handlerFor().handle(context(1) as never)).resolves.toEqual({
      outcome: 'succeeded',
    });
    expect(deliverSystem).toHaveBeenCalledWith({
      dedupKey: 'dead-letter/source-1',
      type: 'operation.dead_letter',
      payload: { operationId: 'source-1', errorCode: 'BAD_INPUT' },
    });
    operation = { kind: 'integration_notification', payload: { sourceOperationId: 'source-2' } };
    await handlerFor().handle(context(1) as never);
    expect(deliverSystem).toHaveBeenLastCalledWith(
      expect.objectContaining({ payload: { operationId: 'source-2', errorCode: null } }),
    );
  });

  it('retries transient delivery errors and dead-letters after the final attempt', async () => {
    operation = { kind: 'integration_notification', payload: { notificationId: 'n1' } };
    deliver.mockRejectedValue(new Error('provider failed'));
    await expect(handlerFor().handle(context(2) as never)).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'NOTIFICATION_DELIVERY_FAILED',
      nextAttemptAt: expect.any(Date),
    });
    await expect(handlerFor().handle(context(5) as never)).resolves.toEqual({
      outcome: 'dead_letter',
      errorCode: 'NOTIFICATION_DELIVERY_FAILED',
    });
  });
});
