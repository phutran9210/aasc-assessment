import { BadRequestException } from '@nestjs/common';
import { JotformController } from '../controllers/jotform.controller.js';

describe('JotformController', () => {
  it('normalizes webhook fields and forwards the submission', async () => {
    const sync = {
      processSubmission: jest.fn().mockResolvedValue({ status: 'synced' }),
      syncForm: jest.fn().mockResolvedValue({ processed: 2 }),
    };
    const controller = new JotformController(sync as never);
    await expect(controller.receive({ submissionID: 1234, formID: '  77 ' })).resolves.toEqual({
      status: 'synced',
    });
    expect(sync.processSubmission).toHaveBeenCalledWith('1234', '77');
    await expect(controller.receive({ submissionID: '  abc ' })).resolves.toEqual({
      status: 'synced',
    });
    expect(sync.processSubmission).toHaveBeenLastCalledWith('abc', undefined);
    await expect(controller.sync()).resolves.toEqual({ processed: 2 });
  });

  it('rejects a missing or non-text submission id', () => {
    const controller = new JotformController({
      processSubmission: jest.fn(),
      syncForm: jest.fn(),
    } as never);
    expect(() => controller.receive(undefined)).toThrow(BadRequestException);
    expect(() => controller.receive({ submissionID: {} })).toThrow(BadRequestException);
  });
});
