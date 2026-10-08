import { IntegrationReadService } from '../services/integration-read.service.js';

describe('IntegrationReadService', () => {
  it('returns a redacted lead DTO and the repository page total', async () => {
    const lead = {
      id: 'lead-1',
      externalId: 'external-1',
      name: 'Ada Lovelace',
      email: 'ada@example.test',
      phone: null,
      city: 'Hanoi',
      firstTouchCampaignId: 'campaign-1',
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      firstTouchAt: new Date('2026-10-01T00:00:00.000Z'),
      score: 8,
      scoreBreakdown: { profile: 8 },
      businessStatus: 'new',
      syncStatus: 'pending',
      bitrixLeadId: null,
      convertedAt: null,
      lastErrorCode: null,
      passwordHash: 'never-return-this',
    };
    const repository = {
      listLeads: jest.fn().mockResolvedValue([[lead], 17]),
    };
    const service = new IntegrationReadService(repository as never);

    const page = await service.listLeads(
      { page: 2, limit: 5, source: 'tiktok' } as never,
      {} as never,
    );
    expect(page).toMatchObject({
      items: [{ id: 'lead-1', email: 'ada@example.test' }],
      total: 17,
      page: 2,
      limit: 5,
    });
    expect(page.items[0]).not.toHaveProperty('passwordHash');
  });
});
