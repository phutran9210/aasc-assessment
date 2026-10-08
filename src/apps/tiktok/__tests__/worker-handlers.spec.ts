import { OPERATION_KINDS } from '@core/queue/constants/operation.constants.js';
import { createTiktokWorkerHandlers, TIKTOK_WORKER_OPERATION_KINDS } from '../worker-handlers.js';

describe('TikTok worker handlers', () => {
  it('registers exactly one handler for each operation kind supported by this worker', () => {
    const handlers = createTiktokWorkerHandlers(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    expect([...handlers.keys()].sort()).toEqual([...TIKTOK_WORKER_OPERATION_KINDS].sort());
    expect(TIKTOK_WORKER_OPERATION_KINDS).toEqual(
      expect.arrayContaining([
        OPERATION_KINDS.tiktokIngest,
        OPERATION_KINDS.bitrixLeadSync,
        OPERATION_KINDS.crmTimeline,
        OPERATION_KINDS.bitrixDealConvert,
        OPERATION_KINDS.bitrixDealRefresh,
        OPERATION_KINDS.tiktokFeedback,
      ]),
    );
    expect(new Set(TIKTOK_WORKER_OPERATION_KINDS).size).toBe(TIKTOK_WORKER_OPERATION_KINDS.length);
    expect([...handlers.values()].every(Boolean)).toBe(true);
  });
});
