import {
  BadGatewayException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BitrixHttpError } from '@modules/bitrix/index.js';
import { LeadSyncEventsController } from '../controllers/lead-sync-events.controller.js';
import { LeadSyncBusyError, LeadSyncConfigError } from '../errors/index.js';

function setup(
  register = jest.fn().mockResolvedValue({ events: ['ONCRMLEADADD'], handler: 'url' }),
  pull = jest.fn().mockResolvedValue({ run: { id: 'run-2' } }),
) {
  const events = { receive: jest.fn().mockResolvedValue(undefined), register };
  const pullback = { start: pull };
  return {
    target: new LeadSyncEventsController(events as never, pullback as never),
    events,
    pullback,
  };
}

describe('LeadSyncEventsController', () => {
  it('accepts incoming events, registers handlers and starts pullback', async () => {
    const state = setup();
    await expect(state.target.receive({ event: 'ONCRMLEADUPDATE' })).resolves.toEqual({
      received: true,
    });
    expect(state.events.receive).toHaveBeenCalledWith({ event: 'ONCRMLEADUPDATE' });
    await expect(state.target.register()).resolves.toEqual({
      events: ['ONCRMLEADADD'],
      handler: 'url',
    });
    await expect(state.target.pull()).resolves.toEqual({ runId: 'run-2' });
    expect(state.pullback.start).toHaveBeenCalledWith('all', 'pull');
  });

  it('maps busy, configuration and Bitrix errors while preserving unknown failures', async () => {
    await expect(
      setup(jest.fn().mockRejectedValue(new LeadSyncBusyError(null))).target.register(),
    ).rejects.toThrow(ConflictException);
    await expect(
      setup(
        jest.fn().mockRejectedValue(new LeadSyncConfigError('not configured')),
      ).target.register(),
    ).rejects.toThrow(ServiceUnavailableException);
    await expect(
      setup(
        jest.fn().mockRejectedValue(new BitrixHttpError('remote error', 'E_CODE', 500)),
      ).target.register(),
    ).rejects.toThrow(BadGatewayException);
    await expect(
      setup(
        jest.fn().mockRejectedValue(new BitrixHttpError('remote error', undefined, 500)),
      ).target.register(),
    ).rejects.toThrow(BadGatewayException);
    const unknown = new Error('unknown');
    await expect(setup(jest.fn().mockRejectedValue(unknown)).target.register()).rejects.toBe(
      unknown,
    );
    await expect(
      setup(undefined, jest.fn().mockRejectedValue(new LeadSyncBusyError('run'))).target.pull(),
    ).rejects.toThrow(ConflictException);
  });
});
