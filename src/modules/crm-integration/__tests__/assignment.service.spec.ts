import { AssignmentService } from '../services/assignment.service.js';
import type { AssignmentCursorRepository } from '../repositories/assignment-cursor.repository.js';
import type { AssignmentPolicy } from '../types/rule.types.js';

describe('AssignmentService', () => {
  const lead = { firstTouchCampaignId: 'campaign-1', city: 'Hanoi' };

  it('chooses a campaign assignment before city and round-robin policies', async () => {
    const cursors = { next: jest.fn() } as unknown as AssignmentCursorRepository;
    const service = new AssignmentService(cursors);
    const policy: AssignmentPolicy = {
      strategy: 'round_robin',
      fallback_sales_id: 'fallback',
      sales_ids: ['sales-1', 'sales-2'],
      campaign_rules: [{ campaign_id: 'campaign-1', sales_id: 'campaign-sales' }],
      city_rules: [{ city: 'Hanoi', sales_id: 'city-sales' }],
    };

    await expect(service.reserve(policy, lead, {} as never)).resolves.toBe('campaign-sales');
    expect(cursors.next).not.toHaveBeenCalled();
  });

  it('chooses city assignment before advancing the round-robin cursor', async () => {
    const cursors = { next: jest.fn() } as unknown as AssignmentCursorRepository;
    const service = new AssignmentService(cursors);
    const policy: AssignmentPolicy = {
      strategy: 'round_robin',
      fallback_sales_id: 'fallback',
      sales_ids: ['sales-1', 'sales-2'],
      city_rules: [{ city: 'HANOI', sales_id: 'city-sales' }],
    };

    await expect(service.reserve(policy, lead, {} as never)).resolves.toBe('city-sales');
    expect(cursors.next).not.toHaveBeenCalled();
  });

  it('uses a durable cursor only after campaign and city rules miss', async () => {
    const cursors = {
      next: jest.fn().mockResolvedValue('sales-2'),
    } as unknown as AssignmentCursorRepository;
    const service = new AssignmentService(cursors);
    const policy: AssignmentPolicy = {
      strategy: 'round_robin',
      fallback_sales_id: 'fallback',
      sales_ids: ['sales-1', 'sales-2'],
    };
    const manager = {} as never;

    await expect(service.reserve(policy, lead, manager)).resolves.toBe('sales-2');
    expect(cursors.next).toHaveBeenCalledWith('default', policy.sales_ids, manager);
  });

  it('uses the configured fallback without advancing the cursor', async () => {
    const cursors = { next: jest.fn() } as unknown as AssignmentCursorRepository;
    const service = new AssignmentService(cursors);
    const policy: AssignmentPolicy = {
      strategy: 'fallback',
      fallback_sales_id: 'fallback',
      sales_ids: ['sales-1'],
    };

    await expect(service.reserve(policy, lead, {} as never)).resolves.toBe('fallback');
    expect(cursors.next).not.toHaveBeenCalled();
  });
});
