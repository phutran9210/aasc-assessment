import type { BitrixApiService } from '../services/bitrix-api.service.js';
import { BitrixBatchService } from '../services/bitrix-batch.service.js';
import type { BitrixBatchCommand } from '../services/bitrix-batch.service.js';

describe('BitrixBatchService', () => {
  const api = { callRaw: jest.fn() };
  let service: BitrixBatchService;

  const commands = (count: number): BitrixBatchCommand[] =>
    Array.from({ length: count }, (_unused, index) => ({
      key: `c${index}`,
      method: 'crm.item.add',
      params: { entityTypeId: 1, fields: { title: `Lead ${index}` } },
    }));

  beforeEach(() => {
    jest.resetAllMocks();
    service = new BitrixBatchService(api as unknown as BitrixApiService);
  });

  it('should send every command in one batch call that does not halt on errors', async () => {
    api.callRaw.mockResolvedValue({ result: { result: { c0: { item: { id: 1 } } } } });

    await service.execute(commands(1));

    expect(api.callRaw).toHaveBeenCalledWith(
      'batch',
      { halt: 0, cmd: { c0: 'crm.item.add?entityTypeId=1&fields[title]=Lead%200' } },
      { timeoutMs: 60_000 },
    );
  });

  it('should split results and errors by command key', async () => {
    api.callRaw.mockResolvedValue({
      result: {
        result: { c0: { item: { id: 912 } }, c2: { item: { id: 913 } } },
        result_error: {
          c1: { error: 'INVALID_ARG_VALUE', error_description: 'Invalid value of field stageId' },
        },
      },
    });

    const outcome = await service.execute(commands(3));

    expect(Object.fromEntries(outcome.results)).toEqual({
      c0: { item: { id: 912 } },
      c2: { item: { id: 913 } },
    });
    expect(Object.fromEntries(outcome.errors)).toEqual({
      c1: { code: 'INVALID_ARG_VALUE', message: 'Invalid value of field stageId' },
    });
  });

  it('should accept the empty arrays PHP sends for "no results" and "no errors"', async () => {
    api.callRaw.mockResolvedValue({ result: { result: { c0: [] }, result_error: [] } });

    const outcome = await service.execute(commands(1));

    expect(outcome.results.get('c0')).toEqual([]);
    expect(outcome.errors.size).toBe(0);
  });

  it('should read an error given as plain text', async () => {
    api.callRaw.mockResolvedValue({
      result: { result: [], result_error: { c0: 'Access denied' } },
    });

    const outcome = await service.execute(commands(1));

    expect(outcome.errors.get('c0')).toEqual({ code: 'UNKNOWN', message: 'Access denied' });
  });

  it('should report a command that got neither a result nor an error', async () => {
    api.callRaw.mockResolvedValue({ result: { result: { c0: true } } });

    const outcome = await service.execute(commands(2));

    expect(outcome.errors.get('c1')).toEqual({
      code: 'NO_RESULT',
      message: 'Bitrix24 không trả kết quả cho lệnh này',
    });
  });

  it('should call nothing for an empty list', async () => {
    const outcome = await service.execute([]);

    expect(outcome.results.size + outcome.errors.size).toBe(0);
    expect(api.callRaw).not.toHaveBeenCalled();
  });

  it('should accept exactly 50 commands and refuse 51', async () => {
    api.callRaw.mockResolvedValue({ result: { result: {} } });

    await expect(service.execute(commands(50))).resolves.toBeDefined();
    await expect(service.execute(commands(51))).rejects.toThrow(RangeError);
    expect(api.callRaw).toHaveBeenCalledTimes(1);
  });

  it('should refuse two commands with the same key', async () => {
    const [first] = commands(1);

    await expect(service.execute([first, first])).rejects.toThrow(/c0/);
  });

  it('should pass call options on, keeping the long batch timeout by default', async () => {
    api.callRaw.mockResolvedValue({ result: { result: {} } });

    await service.execute(commands(1), { retryTransient: true, maxRetries: 4 });

    expect(api.callRaw).toHaveBeenCalledWith('batch', expect.any(Object), {
      timeoutMs: 60_000,
      retryTransient: true,
      maxRetries: 4,
    });
  });
});
