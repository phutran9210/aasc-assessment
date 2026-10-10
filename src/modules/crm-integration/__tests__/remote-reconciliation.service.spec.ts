import { NotFoundException } from '@nestjs/common';

import { RemoteReconciliationService } from '../services/remote-reconciliation.service.js';

describe('RemoteReconciliationService', () => {
  const gateway = {
    findTimeline: jest.fn(),
    findDeals: jest.fn(),
    findLeadCandidates: jest.fn(),
    getLead: jest.fn(),
  };
  const service = new RemoteReconciliationService(gateway as never);

  beforeEach(() => jest.resetAllMocks());

  it('classifies timeline and deal lookup results as missing, unique, or ambiguous', async () => {
    await expect(service.find('timeline', 'marker')).rejects.toThrow(TypeError);
    gateway.findTimeline
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 't1' }])
      .mockResolvedValueOnce([{ id: 't1' }, { id: 't2' }]);
    await expect(
      service.find('timeline', 'marker', { entityType: 'deal', entityId: '1' }),
    ).resolves.toEqual({ status: 'not_found' });
    await expect(
      service.find('timeline', 'marker', { entityType: 'deal', entityId: '1' }),
    ).resolves.toEqual({ status: 'found', value: { id: 't1' } });
    await expect(
      service.find('timeline', 'marker', { entityType: 'deal', entityId: '1' }),
    ).resolves.toEqual({ status: 'ambiguous', candidates: [{ id: 't1' }, { id: 't2' }] });

    gateway.findDeals
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'd1' }])
      .mockResolvedValueOnce([{ id: 'd1' }, { id: 'd2' }]);
    await expect(service.find('deal', 'marker')).resolves.toEqual({ status: 'not_found' });
    await expect(service.find('deal', 'marker')).resolves.toEqual({
      status: 'found',
      value: { id: 'd1' },
    });
    await expect(service.find('deal', 'marker')).resolves.toMatchObject({ status: 'ambiguous' });
  });

  it('looks up a single lead candidate and handles remote deletion separately from transient failures', async () => {
    gateway.findLeadCandidates
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'l1' }])
      .mockResolvedValueOnce([{ id: 'l1' }, { id: 'l2' }]);
    await expect(service.find('lead', 'marker')).resolves.toEqual({ status: 'not_found' });
    gateway.getLead.mockResolvedValueOnce({ id: 'l1', name: 'Lead' });
    await expect(service.find('lead', 'marker')).resolves.toEqual({
      status: 'found',
      value: { id: 'l1', name: 'Lead' },
    });
    await expect(service.find('lead', 'marker')).resolves.toEqual({
      status: 'ambiguous',
      candidates: [{ id: 'l1' }, { id: 'l2' }],
    });
    gateway.findLeadCandidates.mockResolvedValueOnce([{ id: 'deleted' }]);
    gateway.getLead.mockRejectedValueOnce(new NotFoundException());
    await expect(service.find('lead', 'marker')).resolves.toEqual({ status: 'not_found' });
    gateway.findLeadCandidates.mockResolvedValueOnce([{ id: 'error' }]);
    gateway.getLead.mockRejectedValueOnce(new Error('remote unavailable'));
    await expect(service.find('lead', 'marker')).rejects.toThrow('remote unavailable');
  });
});
