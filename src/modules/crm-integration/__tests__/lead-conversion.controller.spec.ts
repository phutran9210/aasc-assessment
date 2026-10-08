import { HttpStatus } from '@nestjs/common';

import { LeadConversionController } from '../controllers/lead-conversion.controller.js';

describe('LeadConversionController', () => {
  it('returns the manual conversion receipt and reflects its completed status', async () => {
    const receipt = { status: 'completed', operationId: 'operation-1' };
    const conversions = { requestManual: jest.fn().mockResolvedValue(receipt) };
    const controller = new LeadConversionController(conversions as never);
    const response = { status: jest.fn() };

    await expect(
      controller.convert(
        'lead-1',
        'idempotency-1',
        { reason: 'requested' },
        { user: { sub: 'actor-1' } } as never,
        response as never,
      ),
    ).resolves.toBe(receipt);

    expect(conversions.requestManual).toHaveBeenCalledWith('lead-1', 'actor-1', 'idempotency-1', {
      reason: 'requested',
    });
    expect(response.status).toHaveBeenCalledWith(HttpStatus.OK);
  });
});
