import { ScoreRecomputeService } from '../services/score-recompute.service.js';

const asOf = '2026-10-09T00:00:00.000Z';

function setup() {
  const manager = {};
  const lead = {
    id: 'lead-1',
    email: 'an@example.test',
    phone: null,
    score: 0,
    scoreBreakdown: {},
    scoreVersion: 1,
    version: 1,
  };
  const dataSource = {
    transaction: jest.fn((callback: (tx: object) => Promise<unknown>) => callback(manager)),
  };
  const analytics = {
    scoreCandidates: jest.fn().mockResolvedValueOnce(['lead-1']).mockResolvedValue([]),
  };
  const leads = {
    findByIdForUpdate: jest.fn().mockResolvedValue(lead),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
  };
  const submissions = { findForLead: jest.fn().mockResolvedValue([]) };
  const configurations = {
    revisions: jest.fn().mockResolvedValue({ mapping: 2, rules: 0, scoring: 0 }),
    findRevision: jest.fn().mockResolvedValue(null),
  };
  const operations = { ensure: jest.fn().mockResolvedValue({ id: 'operation-1' }) };
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const revisions = { increment: jest.fn().mockResolvedValue(undefined) };
  const service = new ScoreRecomputeService(
    dataSource as never,
    analytics as never,
    leads as never,
    submissions as never,
    configurations as never,
    operations as never,
    outbox as never,
    revisions,
  );
  return {
    service,
    lead,
    analytics,
    leads,
    submissions,
    configurations,
    operations,
    outbox,
    revisions,
  };
}

describe('ScoreRecomputeService', () => {
  it('returns zero without opening a transaction when there are no candidates', async () => {
    const { service, analytics, leads } = setup();
    analytics.scoreCandidates.mockReset().mockResolvedValue([]);

    await expect(service.run(asOf)).resolves.toBe(0);
    expect(leads.findByIdForUpdate).not.toHaveBeenCalled();
  });

  it('ignores a candidate removed before its row lock is acquired', async () => {
    const { service, leads, operations } = setup();
    leads.findByIdForUpdate.mockResolvedValueOnce(null);

    await expect(service.run(asOf)).resolves.toBe(0);
    expect(operations.ensure).not.toHaveBeenCalled();
  });

  it('updates a changed score and schedules the next version for CRM sync', async () => {
    const { service, lead, leads, operations, outbox, revisions } = setup();

    await expect(service.run(asOf)).resolves.toBe(1);
    expect(lead).toMatchObject({
      score: 15,
      version: 2,
      scoreVersion: 1,
      scoreBreakdown: { email: 15, phone: 0, form: 0, interaction: 0, budget: 0, timeline: 0 },
    });
    expect(leads.save).toHaveBeenCalledTimes(1);
    expect(operations.ensure.mock.calls[0]?.[0]).toMatchObject({
      operationKey: 'bitrix-lead-sync/lead-1/2',
      configRevisions: { mapping: 2, rules: 0, scoring: 0 },
    });
    expect(outbox.append.mock.calls[0]?.[2]).toEqual(new Date(asOf));
    expect(revisions.increment).toHaveBeenCalledTimes(1);
  });

  it('does not write or enqueue an unchanged score and breakdown', async () => {
    const { service, lead, operations, leads } = setup();
    lead.score = 15;
    lead.scoreBreakdown = { email: 15, phone: 0, form: 0, interaction: 0, budget: 0, timeline: 0 };

    await expect(service.run(asOf)).resolves.toBe(0);
    expect(leads.save).not.toHaveBeenCalled();
    expect(operations.ensure).not.toHaveBeenCalled();
  });

  it('uses the scoring revision of the active rules policy', async () => {
    const { service, lead, configurations } = setup();
    configurations.revisions.mockResolvedValueOnce({ mapping: 2, rules: 7, scoring: 8 });
    configurations.findRevision.mockResolvedValueOnce({
      value: {
        config: {
          quality_scoring: {
            weights: { email: 15, phone: 15, form: 20, interaction: 20, budget: 15, timeline: 15 },
            interaction_window_days: 30,
            interaction_points: 5,
            interaction_cap: 4,
          },
        },
      },
    });

    await expect(service.run(asOf)).resolves.toBe(1);
    expect(lead.scoreVersion).toBe(8);
    expect(configurations.findRevision).toHaveBeenCalledWith('rules', 7, expect.anything());
  });

  it('falls back to the default policy when the referenced revision has no scoring rules', async () => {
    const { service, configurations } = setup();
    configurations.revisions.mockResolvedValueOnce({ mapping: 2, rules: 9, scoring: 0 });
    configurations.findRevision.mockResolvedValueOnce(null);

    await expect(service.run(asOf)).resolves.toBe(1);
    expect(configurations.findRevision).toHaveBeenCalledWith('rules', 9, expect.anything());
  });

  it('uses zero revision defaults and preserves the prior score version when revisions are absent', async () => {
    const { service, lead, configurations, operations } = setup();
    configurations.revisions.mockResolvedValueOnce({});

    await expect(service.run(asOf)).resolves.toBe(1);

    expect(configurations.findRevision).not.toHaveBeenCalled();
    expect(lead.scoreVersion).toBe(1);
    expect(operations.ensure.mock.calls[0]?.[0].configRevisions).toEqual({
      mapping: 0,
      rules: 0,
      scoring: 0,
    });
  });

  it('ignores a non-object scoring policy in the stored rules revision', async () => {
    const { service, configurations } = setup();
    configurations.revisions.mockResolvedValueOnce({ mapping: 2, rules: 9, scoring: 0 });
    configurations.findRevision.mockResolvedValueOnce({ value: { quality_scoring: 'invalid' } });

    await expect(service.run(asOf)).resolves.toBe(1);
    expect(configurations.findRevision).toHaveBeenCalledWith('rules', 9, expect.anything());
  });

  it('continues across batches using the last candidate ID as cursor', async () => {
    const { service, analytics, leads } = setup();
    analytics.scoreCandidates
      .mockReset()
      .mockResolvedValueOnce(['lead-1'])
      .mockResolvedValueOnce(['lead-2'])
      .mockResolvedValue([]);
    leads.findByIdForUpdate.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await expect(service.run(asOf, 1)).resolves.toBe(0);
    expect(analytics.scoreCandidates.mock.calls).toEqual([
      [null, 1],
      ['lead-1', 1],
      ['lead-2', 1],
    ]);
  });
});
