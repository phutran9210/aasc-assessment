import { NotFoundException } from '@nestjs/common';

import { ConfigurationService } from '../services/configuration.service.js';

function setup() {
  const repository = {
    findActive: jest.fn().mockResolvedValue({
      entity: { revision: 3 },
      value: { entries: [{ source: 'name', target: 'name', owner: 'integration' }] },
      compiled: { entries: [] },
    }),
    compareAndSet: jest.fn().mockResolvedValue({
      entity: { revision: 4 },
      value: { entries: [{ source: 'name', target: 'name', owner: 'integration' }] },
      compiled: { entries: [] },
    }),
    revisions: jest.fn().mockResolvedValue({ mapping: 4, rules: 2 }),
  };
  const crm = {
    metadata: jest.fn().mockResolvedValue({
      lead: {
        fields: {
          name: { name: 'name', readOnly: false },
          title: { name: 'title', maxLength: 180, readOnly: false },
        },
      },
      stages: [],
      users: [],
    }),
  };
  return { service: new ConfigurationService(repository as never, crm as never), repository, crm };
}

describe('ConfigurationService If-Match handling', () => {
  it('rejects a missing If-Match without reading provider metadata or writing', async () => {
    const repository = { compareAndSet: jest.fn(), findActive: jest.fn() };
    const crm = { metadata: jest.fn() };
    const service = new ConfigurationService(repository as never, crm as never);

    await expect(
      service.replaceFromIfMatch('mapping', { fields: [] }, undefined, 'actor-1'),
    ).rejects.toMatchObject({ status: 428 });

    expect(crm.metadata).not.toHaveBeenCalled();
    expect(repository.compareAndSet).not.toHaveBeenCalled();
  });

  it('rejects malformed If-Match before reading provider metadata or writing', async () => {
    const repository = { compareAndSet: jest.fn(), findActive: jest.fn() };
    const crm = { metadata: jest.fn() };
    const service = new ConfigurationService(repository as never, crm as never);

    await expect(
      service.replaceFromIfMatch('mapping', { fields: [] }, 'revision-3', 'actor-1'),
    ).rejects.toMatchObject({ status: 400 });

    expect(crm.metadata).not.toHaveBeenCalled();
    expect(repository.compareAndSet).not.toHaveBeenCalled();
  });

  it.each(['"-1"', '"01"', '3', '"9007199254740992"'])(
    'rejects invalid If-Match %s',
    async (etag) => {
      const { service, repository } = setup();

      await expect(
        service.replaceFromIfMatch('mapping', {}, etag, 'actor-1'),
      ).rejects.toMatchObject({ status: 400 });
      expect(repository.compareAndSet).not.toHaveBeenCalled();
    },
  );

  it('accepts a quoted revision and passes it to the compare-and-set write', async () => {
    const { service, repository } = setup();

    const result = await service.replaceFromIfMatch(
      'mapping',
      { entries: [{ source: 'name', target: 'name', owner: 'integration' }] },
      ' "3" ',
      'actor-1',
    );

    expect(result).toMatchObject({ key: 'mapping', revision: 4, etag: '"4"' });
    expect(repository.compareAndSet.mock.calls[0]?.[0]).toMatchObject({
      expectedRevision: 3,
      actorId: 'actor-1',
      compiled: { entries: [{ sourcePath: ['name'], target: 'name' }], titleMaxLength: 180 },
    });
  });

  it('reads the built-in mapping at revision zero when none has been stored', async () => {
    const { service, repository } = setup();
    repository.findActive.mockRejectedValueOnce(new Error('not found'));
    await expect(service.read('mapping')).rejects.toThrow('not found');
    repository.findActive.mockRejectedValueOnce(new NotFoundException());

    await expect(service.read('mapping')).resolves.toMatchObject({
      key: 'mapping',
      revision: 0,
      etag: '"0"',
      compiled: { entries: expect.any(Array) },
    });
  });

  it('rejects unsupported keys and negative revisions before reading provider metadata', async () => {
    const { service, crm } = setup();

    await expect(service.read('unknown')).rejects.toThrow('Configuration key is invalid');
    await expect(service.replace('mapping', {}, -1, 'actor-1')).rejects.toThrow(
      'Expected configuration revision is invalid',
    );
    await expect(service.replace('scoring', {}, 0, 'actor-1')).rejects.toThrow(
      'Configuration key is not supported yet',
    );
    expect(crm.metadata).not.toHaveBeenCalled();
  });

  it('rejects an invalid mapping document before making a provider call', async () => {
    const { service, crm } = setup();

    await expect(service.replace('mapping', { entries: [] }, 3, 'actor-1')).rejects.toThrow(
      'Invalid mapping configuration',
    );
    expect(crm.metadata).not.toHaveBeenCalled();
  });

  it('returns zero for missing revisions in a configuration snapshot', async () => {
    const { service, repository } = setup();
    repository.revisions.mockResolvedValueOnce({ mapping: 4 });

    await expect(service.snapshot({} as never)).resolves.toEqual({
      mapping: 4,
      rules: 0,
      scoring: 0,
    });
  });

  it('imports the assignment field mapping into the versioned configuration', async () => {
    const { service, repository } = setup();
    await expect(
      service.replace(
        'mapping',
        { field_mapping: { 'lead_data.full_name': 'NAME' } },
        3,
        'actor-1',
      ),
    ).resolves.toMatchObject({ key: 'mapping', revision: 4 });
    expect(repository.compareAndSet).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'mapping',
        expectedRevision: 3,
        actorId: 'actor-1',
        compiled: expect.objectContaining({
          entries: expect.arrayContaining([
            expect.objectContaining({ sourcePath: ['name'], target: 'name' }),
          ]),
        }),
      }),
    );
  });

  it('imports assignment deal rules while preserving the active policy sections', async () => {
    const { service, repository, crm } = setup();
    const activeRules = {
      schema_version: 1,
      auto_conversion: { enabled: false },
      manual_conversion: {
        enabled: false,
        pipeline_id: 1,
        stage_id: 'C1:NEW',
        probability: 25,
        fallback_sales_id: 'sales',
      },
      stage_probabilities: [],
      assignment: { strategy: 'fallback', fallback_sales_id: 'sales', sales_ids: ['sales'] },
      quality_scoring: {
        weights: {
          email: 15,
          phone: 15,
          form: 20,
          interaction: 20,
          budget: 15,
          timeline: 15,
        },
        interaction_window_days: 30,
        interaction_points: 5,
        interaction_cap: 4,
      },
      feedback: { enabled: false },
      reporting: { timezone: 'UTC' },
      alerts: { enabled: false },
      rules: [],
    };
    repository.findActive.mockResolvedValueOnce({
      entity: { revision: 6 },
      value: activeRules,
      compiled: null,
    });
    crm.metadata.mockResolvedValueOnce({
      lead: { fields: {} },
      stages: [{ id: 'C1:NEW', name: 'New', categoryId: 1, semantic: null }],
      users: [{ id: 'sales', name: 'Sales', active: true }],
    });

    await expect(
      service.replace(
        'rules',
        {
          deal_rules: [
            {
              condition: "campaign.campaign_name CONTAINS 'sale'",
              action: 'create_deal',
              pipeline_id: 1,
              stage_id: 'NEW',
              probability: 25,
            },
          ],
        },
        7,
        'actor-1',
      ),
    ).resolves.toMatchObject({ key: 'rules', revision: 4 });
    expect(repository.compareAndSet).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'rules',
        expectedRevision: 7,
        compiled: null,
        value: expect.objectContaining({
          assignment: activeRules.assignment,
          rules: [expect.objectContaining({ stage_id: 'C1:NEW', pipeline_id: 1 })],
        }),
      }),
    );
  });

  it('requires an existing rules policy before importing assignment deal rules', async () => {
    const { service, repository } = setup();
    repository.findActive.mockRejectedValueOnce(new NotFoundException());
    await expect(service.replace('rules', { deal_rules: [] }, 3, 'actor-1')).rejects.toThrow(
      'store one with PUT',
    );
    expect(repository.compareAndSet).not.toHaveBeenCalled();
  });

  it('checks rules against CRM stages and active sales users', async () => {
    const { service, crm } = setup();
    const rules = {
      schema_version: 1,
      auto_conversion: { enabled: false },
      manual_conversion: {
        enabled: false,
        pipeline_id: 1,
        stage_id: 'OPEN',
        probability: 25,
        fallback_sales_id: 'sales',
      },
      stage_probabilities: [],
      assignment: { strategy: 'fallback', fallback_sales_id: 'sales', sales_ids: ['sales'] },
      quality_scoring: {
        weights: { email: 15, phone: 15, form: 20, interaction: 20, budget: 15, timeline: 15 },
        interaction_window_days: 30,
        interaction_points: 5,
        interaction_cap: 4,
      },
      feedback: { enabled: false },
      reporting: { timezone: 'UTC' },
      alerts: { enabled: false },
      rules: [
        {
          id: 'rule-1',
          priority: 1,
          enabled: true,
          conditions: { field: 'lead.source', op: 'eq', value: 'x' },
          action: 'create_deal',
          pipeline_id: 1,
          stage_id: 'WON',
          probability: 50,
          assignment: { sales_id: 'missing' },
        },
      ],
    };
    crm.metadata.mockResolvedValueOnce({
      lead: { fields: {} },
      stages: [
        { id: 'OPEN', name: 'Open', categoryId: 1, semantic: null },
        { id: 'WON', name: 'Won', categoryId: 1, semantic: 'S' },
      ],
      users: [{ id: 'sales', active: true }],
    });
    await expect(service.replace('rules', rules, 3, 'actor-1')).rejects.toThrow(
      'Won and lost stages require probability',
    );
    crm.metadata.mockResolvedValueOnce({
      lead: { fields: {} },
      stages: [{ id: 'OPEN', name: 'Open', categoryId: 1, semantic: null }],
      users: [{ id: 'sales', active: true }],
    });
    await expect(
      service.replace(
        'rules',
        { ...rules, rules: [{ ...rules.rules[0], stage_id: 'MISSING', probability: 50 }] },
        3,
        'actor-1',
      ),
    ).rejects.toThrow('Configured stage does not belong');
    crm.metadata.mockResolvedValueOnce({
      lead: { fields: {} },
      stages: [
        { id: 'OPEN', name: 'Open', categoryId: 1, semantic: null },
        { id: 'MISSING', name: 'Other', categoryId: 1, semantic: null },
      ],
      users: [{ id: 'sales', active: false }],
    });
    await expect(
      service.replace(
        'rules',
        { ...rules, rules: [{ ...rules.rules[0], stage_id: 'MISSING', probability: 50 }] },
        3,
        'actor-1',
      ),
    ).rejects.toThrow('active sales user');
  });
});
