import { LeadImportService } from '../services/lead-import.service.js';
import { buildLeadImportRow } from '../domain/lead-import-row.js';
import { ConflictException } from '@nestjs/common';

const good = {
  source_record_id: 'src-1',
  advertiser_id: 'adv',
  occurred_at: '2026-01-01T00:00:00Z',
  full_name: 'Example Lead',
  email: 'lead@example.test',
  phone: '+84901234567',
};
const actor = {
  sub: 'operator',
  sid: 'session',
  username: 'operator',
  roles: ['integration_operator'],
};
const context = {
  operationId: 'job-1',
  ownerToken: 'job-1',
  attempt: 1,
  revisions: { mapping: 0, rules: 0, scoring: 0 },
  signal: new AbortController().signal,
  assertOwnership: () => Promise.resolve(),
  acquireAggregateLease: () => Promise.resolve(null),
  releaseAggregateLease: () => Promise.resolve(true),
};

function setup(
  records: Array<Record<string, string> | null>,
  options: {
    existingHash?: string | null;
    identities?: string[];
    dryRun?: boolean;
    withIngest?: boolean;
    ingestOutcome?: unknown;
    acceptConflict?: boolean;
    acceptError?: Error;
  } = {},
) {
  const job = {
    id: 'job-1',
    status: 'running',
    cursor: '0',
    filters: {
      dryRun: options.dryRun ?? true,
      applyRules: false,
      sendFeedback: false,
      preview: { create: 0, merge: 0, noop: 0 },
    },
  };
  const support = {
    register: jest.fn().mockResolvedValue({ id: 'job-1' }),
    load: jest.fn().mockResolvedValue({
      job,
      records: records.map((values, index) => ({
        rowNumber: index + 2,
        values,
        errorCode: values ? undefined : 'ROW_MALFORMED',
      })),
    }),
    replayed: jest
      .fn()
      .mockReturnValue({ processed: 0, succeeded: 0, failed: 0, nextCursor: 3, done: false }),
    recordErrors: jest.fn().mockResolvedValue(undefined),
    checkpoint: jest.fn().mockResolvedValue(undefined),
  };
  const eventRows = {
    findOne: jest
      .fn()
      .mockResolvedValue(
        options.existingHash === undefined ? null : { payloadHash: options.existingHash },
      ),
  };
  const dataSource = {
    manager: {},
    getRepository: jest.fn(() => eventRows),
    transaction: jest.fn((work) => work({})),
  };
  const identities = {
    findByValues: jest
      .fn()
      .mockResolvedValue((options.identities ?? []).map((leadId) => ({ leadId }))),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const webhookEvents = {
    accept: jest.fn().mockImplementation(() => {
      if (options.acceptConflict) throw new ConflictException();
      if (options.acceptError) throw options.acceptError;
      return { eventId: 'event-imported' };
    }),
  };
  const ingest = {
    process: jest.fn().mockResolvedValue(options.ingestOutcome ?? { outcome: 'succeeded' }),
  };
  const configurations = { revisions: jest.fn().mockResolvedValue({ mapping: 1 }) };
  const service = new LeadImportService(
    dataSource as never,
    support as never,
    webhookEvents as never,
    options.withIngest ? ingest : null,
    configurations as never,
    identities as never,
    audit,
    { advertiserId: 'adv', tiktokMode: 'mock', defaultPhoneRegion: 'VN' },
  );
  return {
    service,
    support,
    eventRows,
    dataSource,
    identities,
    audit,
    job,
    webhookEvents,
    ingest,
    configurations,
  };
}

describe('LeadImportService', () => {
  it('records malformed and invalid rows while previewing valid create and merge candidates', async () => {
    const state = setup(
      [
        null,
        { ...good, source_record_id: 'bad', advertiser_id: 'other' },
        good,
        { ...good, source_record_id: 'src-2' },
      ],
      { identities: ['lead-existing'] },
    );
    const result = await state.service.processChunk('job-1', 0, 10, context);
    expect(result).toEqual({ processed: 4, succeeded: 2, failed: 2, nextCursor: 4, done: true });
    expect(state.support.recordErrors).toHaveBeenCalledWith(
      'job-1',
      expect.arrayContaining([
        expect.objectContaining({ errorCode: 'ROW_MALFORMED' }),
        expect.objectContaining({ errorCode: 'ADVERTISER_MISMATCH' }),
      ]),
    );
    expect(state.support.checkpoint).toHaveBeenCalledWith(
      'job-1',
      0,
      result,
      expect.objectContaining({ preview: { create: 0, merge: 2, noop: 0 } }),
      {},
    );
  });

  it('marks duplicate source rows and matching existing events as no-ops', async () => {
    const hash = buildLeadImportRow(good, 'adv', new Date('2026-02-01T00:00:00Z'));
    if (!hash.ok) throw new Error('fixture must be valid');
    const state = setup([good, good], { existingHash: hash.payloadHash });
    const result = await state.service.processChunk('job-1', 0, 10, context);
    expect(result).toMatchObject({ processed: 2, failed: 1, succeeded: 1 });
    expect(state.support.recordErrors).toHaveBeenCalledWith('job-1', [
      expect.objectContaining({ errorCode: 'DUPLICATE_SOURCE_RECORD_ID' }),
    ]);
    expect(state.support.checkpoint).toHaveBeenCalledWith(
      'job-1',
      0,
      result,
      expect.objectContaining({ preview: { create: 0, merge: 0, noop: 1 } }),
      {},
    );
  });

  it('rejects an existing event whose payload differs from the import row', async () => {
    const state = setup([good], { existingHash: 'different-hash' });
    await expect(
      state.service.processChunk('job-1', 0, 10, context as never),
    ).resolves.toMatchObject({ failed: 1, succeeded: 0 });
    expect(state.support.recordErrors).toHaveBeenCalledWith('job-1', [
      expect.objectContaining({ errorCode: 'SOURCE_RECORD_CONTENT_CONFLICT' }),
    ]);
  });

  it('returns the stored result when the cursor was already processed or the job is complete', async () => {
    const state = setup([good]);
    state.job.cursor = '2';
    await expect(state.service.processChunk('job-1', 0, 10, context as never)).resolves.toEqual({
      processed: 0,
      succeeded: 0,
      failed: 0,
      nextCursor: 3,
      done: false,
    });
    expect(state.support.replayed).toHaveBeenCalledWith(state.job);

    state.job.cursor = '0';
    state.job.status = 'completed';
    await state.service.processChunk('job-1', 0, 10, context);
    expect(state.support.replayed).toHaveBeenCalledTimes(2);
  });

  it('registers safe defaults and audits live imports before commit', async () => {
    const state = setup([]);
    const file = { path: '/tmp/leads.csv', originalName: 'leads.csv', size: 10 };
    await state.service.start(file, {}, actor as never);
    const registration = state.support.register.mock.calls[0][0];
    expect(registration.operationKey('job-4')).toBe('lead-import/job-4');
    expect(registration.filters).toMatchObject({
      dryRun: true,
      applyRules: false,
      sendFeedback: false,
      advertiserId: 'adv',
    });
    await registration.beforeCommit('job-2', {});
    expect(state.audit.record).not.toHaveBeenCalled();

    await state.service.start(
      file,
      { dryRun: false, applyRules: true, sendFeedback: true },
      actor as never,
    );
    const liveRegistration = state.support.register.mock.calls[1][0];
    await liveRegistration.beforeCommit('job-3', {});
    expect(state.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'import.leads.started',
        metadata: { dryRun: false, applyRules: true, sendFeedback: true },
      }),
      {},
    );
  });

  it('commits valid live rows through the webhook and ingest pipeline', async () => {
    const state = setup([good], { dryRun: false, withIngest: true });
    const result = await state.service.processChunk('job-1', 0, 10, context);
    expect(result).toMatchObject({ processed: 1, succeeded: 1, done: true });
    expect(state.webhookEvents.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'tiktok',
        eventType: 'lead.generate',
        rawBody: expect.any(Buffer),
      }),
      {},
    );
    expect(state.ingest.process).toHaveBeenCalledWith('event-imported', context, undefined, {
      applyRules: false,
      sendFeedback: false,
    });
  });

  it('records live conflicts and quarantine outcomes as row errors', async () => {
    const conflict = setup([good], { dryRun: false, withIngest: true, acceptConflict: true });
    await expect(
      conflict.service.processChunk('job-1', 0, 10, context as never),
    ).resolves.toMatchObject({ failed: 1, succeeded: 0 });
    expect(conflict.support.recordErrors).toHaveBeenCalledWith('job-1', [
      expect.objectContaining({ errorCode: 'SOURCE_RECORD_CONTENT_CONFLICT' }),
    ]);

    const duplicate = setup([good], {
      dryRun: false,
      withIngest: true,
      ingestOutcome: { outcome: 'quarantined', errorCode: 'SUBMISSION_KEY_CONTENT_CONFLICT' },
    });
    await expect(
      duplicate.service.processChunk('job-1', 0, 10, context as never),
    ).resolves.toMatchObject({ failed: 1 });
    expect(duplicate.support.recordErrors).toHaveBeenCalledWith('job-1', [
      expect.objectContaining({ errorCode: 'SOURCE_RECORD_CONTENT_CONFLICT' }),
    ]);

    const invalid = setup([good], {
      dryRun: false,
      withIngest: true,
      ingestOutcome: { outcome: 'quarantined', errorCode: 'NORMALIZATION_FAILED' },
    });
    await expect(
      invalid.service.processChunk('job-1', 0, 10, context as never),
    ).resolves.toMatchObject({ failed: 1 });
    expect(invalid.support.recordErrors).toHaveBeenCalledWith('job-1', [
      expect.objectContaining({ errorCode: 'NORMALIZATION_FAILED' }),
    ]);
  });

  it('rejects live rows in the API process when no ingest worker is available', async () => {
    const state = setup([good], { dryRun: false });
    await expect(state.service.processChunk('job-1', 0, 10, context as never)).rejects.toThrow(
      'processed by the worker only',
    );
  });

  it('builds a standalone worker context when no operation context is provided', async () => {
    const state = setup([good]);
    await expect(state.service.processChunk('job-1', 0)).resolves.toMatchObject({ succeeded: 1 });
    expect(state.configurations.revisions).toHaveBeenCalledWith(state.dataSource.manager);
  });

  it('previews creates without identities and rejects a dry-run identity conflict', async () => {
    const create = setup([good]);
    await expect(
      create.service.processChunk('job-1', 0, 10, context as never),
    ).resolves.toMatchObject({
      succeeded: 1,
    });
    expect(create.support.checkpoint).toHaveBeenCalledWith(
      'job-1',
      0,
      expect.anything(),
      expect.objectContaining({ preview: { create: 1, merge: 0, noop: 0 } }),
      {},
    );

    const conflict = setup([good], { identities: ['lead-1', 'lead-2'] });
    await expect(
      conflict.service.processChunk('job-1', 0, 10, context as never),
    ).resolves.toMatchObject({ failed: 1, succeeded: 0 });
    expect(conflict.support.recordErrors).toHaveBeenCalledWith('job-1', [
      expect.objectContaining({ errorCode: 'IDENTITY_CONFLICT' }),
    ]);
  });

  it('reports blank source IDs and ignores them in first-occurrence tracking', async () => {
    const state = setup([{ ...good, source_record_id: '   ' }]);
    await expect(
      state.service.processChunk('job-1', 0, 10, context as never),
    ).resolves.toMatchObject({ failed: 1 });
    expect(state.support.recordErrors).toHaveBeenCalledWith('job-1', [
      expect.objectContaining({ errorCode: 'SOURCE_RECORD_ID_MISSING' }),
    ]);
  });

  it('quarantines historical rows without a usable contact identifier', async () => {
    const state = setup([
      {
        source_record_id: 'src-no-contact',
        advertiser_id: 'adv',
        occurred_at: good.occurred_at,
        full_name: 'No Contact',
      },
    ]);

    await expect(
      state.service.processChunk('job-1', 0, 10, context as never),
    ).resolves.toMatchObject({
      failed: 1,
      succeeded: 0,
    });
    expect(state.support.recordErrors).toHaveBeenCalledWith('job-1', [
      expect.objectContaining({ errorCode: 'CONTACT_IDENTIFIER_MISSING' }),
    ]);
    expect(state.identities.findByValues).not.toHaveBeenCalled();
  });

  it('handles optional email and phone values and initializes a missing preview counter', async () => {
    const state = setup([{ ...good, email: '', phone: '+84901234567' }]);
    state.job.filters.preview = null as never;

    await expect(
      state.service.processChunk('job-1', 0, 10, context as never),
    ).resolves.toMatchObject({
      succeeded: 1,
    });
    expect(state.identities.findByValues).toHaveBeenCalledWith(
      'adv',
      [{ type: 'phone', value: '+84901234567' }],
      state.dataSource.manager,
    );
    expect(state.support.checkpoint).toHaveBeenCalledWith(
      'job-1',
      0,
      expect.anything(),
      expect.objectContaining({ preview: { create: 1, merge: 0, noop: 0 } }),
      {},
    );
  });

  it('uses the generic malformed-row code when an import record has no error code', async () => {
    const state = setup([]);
    state.support.load.mockResolvedValueOnce({
      job: state.job,
      records: [{ rowNumber: 2, values: null, errorCode: undefined }],
    });

    await expect(
      state.service.processChunk('job-1', 0, 10, context as never),
    ).resolves.toMatchObject({
      failed: 1,
    });
    expect(state.support.recordErrors).toHaveBeenCalledWith('job-1', [
      expect.objectContaining({ errorCode: 'ROW_MALFORMED' }),
    ]);
  });

  it('rethrows unexpected webhook repository failures', async () => {
    const failure = new Error('database unavailable');
    const state = setup([good], { dryRun: false, withIngest: true, acceptError: failure });
    await expect(state.service.processChunk('job-1', 0, 10, context as never)).rejects.toBe(
      failure,
    );
  });
});
