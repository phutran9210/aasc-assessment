import { BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';

import { KeyedMutex } from '../keyed-mutex.js';
import { GameRuleError, toAck } from '../ws-ack.js';

describe('toAck', () => {
  let error: jest.SpyInstance;

  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('should wrap the result when the handler succeeds', async () => {
    expect(await toAck(() => ({ score: 5 }))).toEqual({ ok: true, data: { score: 5 } });
    expect(await toAck(() => Promise.resolve('async'))).toEqual({ ok: true, data: 'async' });
  });

  it('should return the rule message without logging when a game rule is broken', async () => {
    const ack = await toAck(() => {
      throw new GameRuleError('Chưa đến lượt của bạn');
    });

    expect(ack).toEqual({ ok: false, message: 'Chưa đến lượt của bạn' });
    expect(error).not.toHaveBeenCalled();
  });

  it('should return the message of a 4xx HttpException', async () => {
    const ack = await toAck(() => Promise.reject(new BadRequestException('Dữ liệu không hợp lệ')));

    expect(ack).toEqual({ ok: false, message: 'Dữ liệu không hợp lệ' });
  });

  it.each([
    ['an unexpected Error', new Error('SQLITE_BUSY')],
    ['a 5xx HttpException', new InternalServerErrorException('stack details')],
    ['a non-Error value', 'boom'],
  ])('should hide the details and log when the handler throws %s', async (_case, thrown) => {
    const ack = await toAck(() => {
      throw thrown;
    });

    expect(ack).toEqual({ ok: false, message: 'Lỗi hệ thống, vui lòng thử lại sau' });
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('KeyedMutex', () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('should run jobs of the same key one at a time, in order', async () => {
    const mutex = new KeyedMutex();
    const events: string[] = [];
    const job = (name: string, ms: number) => async () => {
      events.push(`start ${name}`);
      await sleep(ms);
      events.push(`end ${name}`);
      return name;
    };

    const results = await Promise.all([mutex.run('k', job('a', 20)), mutex.run('k', job('b', 1))]);

    expect(results).toEqual(['a', 'b']);
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  it('should let jobs of different keys overlap', async () => {
    const mutex = new KeyedMutex();
    const events: string[] = [];
    const job = (name: string, ms: number) => async () => {
      events.push(`start ${name}`);
      await sleep(ms);
      events.push(`end ${name}`);
    };

    await Promise.all([mutex.run('x', job('a', 20)), mutex.run('y', job('b', 1))]);

    expect(events).toEqual(['start a', 'start b', 'end b', 'end a']);
  });

  it('should keep running later jobs when an earlier one fails', async () => {
    const mutex = new KeyedMutex();

    const failing = mutex.run('k', () => Promise.reject(new Error('first failed')));
    const next = mutex.run('k', () => Promise.resolve('second ran'));

    await expect(failing).rejects.toThrow('first failed');
    await expect(next).resolves.toBe('second ran');
  });
});
