import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import type { CampaignDailyEntity } from '../entities/campaign-daily.entity.js';
import type { AnalyticsRevisionRepository } from '../repositories/analytics-revision.repository.js';
import type { CampaignCostRepository } from '../repositories/campaign-cost.repository.js';
import { CampaignCostService } from '../services/campaign-cost.service.js';
import type { CampaignCostRow } from '../types/analytics.types.js';

const tx = {} as EntityManager;
const row: CampaignCostRow = {
  advertiserId: 'adv-1',
  campaignId: 'cmp-1',
  reportDate: '2026-10-01',
  reportingTimezone: 'Asia/Ho_Chi_Minh',
  currency: 'vnd',
  spend: '1000000',
};

function createService(existing: Array<Partial<CampaignDailyEntity>> = []) {
  const written: Array<Partial<CampaignDailyEntity>> = [];
  const touched: string[] = [];
  let revisions = 0;
  const repository = {
    findForUpdate: () => Promise.resolve(existing),
    upsert: (values: Array<Partial<CampaignDailyEntity>>) => {
      written.push(...values);
      return Promise.resolve();
    },
    touch: (ids: string[]) => {
      touched.push(...ids);
      return Promise.resolve();
    },
  } as unknown as CampaignCostRepository;
  const revisionRepository = {
    increment: () => {
      revisions += 1;
      return Promise.resolve();
    },
  } as unknown as AnalyticsRevisionRepository;
  return {
    service: new CampaignCostService(repository, revisionRepository),
    written,
    touched,
    revisions: () => revisions,
  };
}

describe('campaign cost service', () => {
  it('normalizes currency and bumps the analytics revision once for new rows', async () => {
    const { service, written, revisions } = createService();

    const summary = await service.upsert(
      [row, { ...row, reportDate: '2026-10-02', spend: '0' }],
      'import',
      tx,
    );

    expect(summary).toEqual({ inserted: 2, updated: 0, unchanged: 0 });
    expect(written).toEqual([
      expect.objectContaining({ currency: 'VND', spend: '1000000', source: 'import' }),
      expect.objectContaining({ reportDate: '2026-10-02', spend: '0' }),
    ]);
    expect(revisions()).toBe(1);
  });

  it('keeps the last row when a batch repeats a natural key', async () => {
    const { service, written } = createService();

    const summary = await service.upsert([row, { ...row, spend: '2500.5' }], 'mock', tx);

    expect(summary).toEqual({ inserted: 1, updated: 0, unchanged: 0 });
    expect(written).toEqual([expect.objectContaining({ spend: '2500.5' })]);
  });

  it('only refreshes fetchedAt and leaves the revision alone when nothing material changed', async () => {
    const { service, written, touched, revisions } = createService([
      {
        id: 'row-1',
        campaignId: 'cmp-1',
        reportDate: '2026-10-01',
        currency: 'VND',
        spend: '1000000.0000',
        impressions: null,
        clicks: null,
        reportingTimezone: 'Asia/Ho_Chi_Minh',
      },
    ]);

    const summary = await service.upsert([row], 'import', tx);

    expect(summary).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
    expect(written).toEqual([]);
    expect(touched).toEqual(['row-1']);
    expect(revisions()).toBe(0);
  });

  it('counts a changed spend as a material update', async () => {
    const { service, revisions } = createService([
      {
        id: 'row-1',
        campaignId: 'cmp-1',
        reportDate: '2026-10-01',
        currency: 'VND',
        spend: '999999.9999',
        impressions: null,
        clicks: null,
        reportingTimezone: 'Asia/Ho_Chi_Minh',
      },
    ]);

    expect(await service.upsert([row], 'import', tx)).toEqual({
      inserted: 0,
      updated: 1,
      unchanged: 0,
    });
    expect(revisions()).toBe(1);
  });

  it.each([
    ['negative spend', { spend: '-1' }],
    ['exponent spend', { spend: '1e3' }],
    ['more than four decimals', { spend: '1.00001' }],
    ['spend above numeric(20,4)', { spend: '10000000000000000' }],
    ['float spend', { spend: 12.5 as unknown as string }],
    ['bad currency', { currency: 'VNDD' }],
    ['impossible date', { reportDate: '2026-02-30' }],
    ['bad timezone', { reportingTimezone: 'Nowhere/City' }],
    ['negative clicks', { clicks: '-3' }],
    ['fractional impressions', { impressions: '1.5' }],
    ['blank campaign', { campaignId: ' ' }],
  ])('rejects %s without writing anything', async (_name, patch) => {
    const { service, written, revisions } = createService();

    await expect(service.upsert([row, { ...row, ...patch }], 'import', tx)).rejects.toThrow(
      BadRequestException,
    );
    expect(written).toEqual([]);
    expect(revisions()).toBe(0);
  });

  it('does nothing for an empty batch', async () => {
    const { service, revisions } = createService();

    expect(await service.upsert([], 'api', tx)).toEqual({ inserted: 0, updated: 0, unchanged: 0 });
    expect(revisions()).toBe(0);
  });
});
