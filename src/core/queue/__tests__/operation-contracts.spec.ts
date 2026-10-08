import {
  OPERATION_KINDS,
  OPERATION_QUEUE,
  QUEUE_NAMES,
  RETRYABLE_OPERATION_KINDS,
  retryQueueForOperation,
} from '../constants/operation.constants.js';

describe('operation queue contracts', () => {
  it('maps every operation kind to exactly one queue', () => {
    const operationKinds = Object.values(OPERATION_KINDS);
    const mappedKinds = Object.keys(OPERATION_QUEUE);

    expect(mappedKinds).toHaveLength(operationKinds.length);
    expect(mappedKinds.sort()).toEqual([...operationKinds].sort());
    expect(
      Object.values(OPERATION_QUEUE).every((queue) => Object.values(QUEUE_NAMES).includes(queue)),
    ).toBe(true);
  });

  it('limits manual retries to retryable kinds and reuses the shared queue mapping', () => {
    const retryableKinds = new Set<string>(RETRYABLE_OPERATION_KINDS);

    for (const kind of RETRYABLE_OPERATION_KINDS) {
      expect(retryQueueForOperation(kind)).toBe(OPERATION_QUEUE[kind]);
    }

    for (const kind of Object.values(OPERATION_KINDS)) {
      if (!retryableKinds.has(kind)) expect(retryQueueForOperation(kind)).toBeUndefined();
    }
  });
});
