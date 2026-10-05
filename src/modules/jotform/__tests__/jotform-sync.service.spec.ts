import { jotformConfig } from '@config/index.js';
import { ContactService } from '@modules/contact/index.js';

import { BadGatewayException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { JotformSubmissionRepository } from '../repositories/jotform-submission.repository.js';
import { JotformApiError, JotformApiService } from '../services/jotform-api.service.js';
import { JotformSyncService } from '../services/jotform-sync.service.js';
import type { JotformSubmissionContent } from '../types/index.js';

const FORM_ID = '252770000000001';

const submission = (id: string, email = 'an@example.com'): JotformSubmissionContent => ({
  id,
  form_id: FORM_ID,
  answers: {
    '3': { order: '1', type: 'control_fullname', answer: { first: 'An', last: 'Nguyễn' } },
    '4': { order: '2', type: 'control_phone', answer: { full: '0901234567' } },
    '5': { order: '3', type: 'control_email', answer: email },
  },
});

describe('JotformSyncService', () => {
  const jotformApi = { getSubmission: jest.fn(), listSubmissions: jest.fn() };
  const repository = { claim: jest.fn(), markSynced: jest.fn(), markFailed: jest.fn() };
  const contacts = { create: jest.fn() };

  const build = async (config: Record<string, unknown> = {}): Promise<JotformSyncService> => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        JotformSyncService,
        { provide: JotformApiService, useValue: jotformApi },
        { provide: JotformSubmissionRepository, useValue: repository },
        { provide: ContactService, useValue: contacts },
        {
          provide: jotformConfig.KEY,
          useValue: { apiKey: 'key', formId: FORM_ID, webhookSecret: 's', ...config },
        },
      ],
    }).compile();
    return moduleRef.get(JotformSyncService);
  };

  const claimed = (submissionId: string) => ({
    outcome: 'claimed',
    record: { id: `row-${submissionId}`, submissionId, bitrixContactId: null },
  });

  let service: JotformSyncService;
  let logSpy: jest.SpiedFunction<Logger['log']>;
  let errorSpy: jest.SpiedFunction<Logger['error']>;

  beforeEach(async () => {
    jest.resetAllMocks();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    repository.claim.mockImplementation((id: string) => Promise.resolve(claimed(id)));
    service = await build();
  });

  afterEach(() => jest.restoreAllMocks());

  it('should create a contact with NAME, PHONE and EMAIL and mark the submission synced', async () => {
    jotformApi.getSubmission.mockResolvedValue(submission('6001'));
    contacts.create.mockResolvedValue({ id: '42' });

    await expect(service.processSubmission('6001', FORM_ID)).resolves.toEqual({
      status: 'synced',
      submissionId: '6001',
      contactId: '42',
    });

    expect(contacts.create).toHaveBeenCalledWith({
      name: 'An Nguyễn',
      phone: '0901234567',
      email: 'an@example.com',
    });
    expect(repository.markSynced).toHaveBeenCalledWith('row-6001', '42');
  });

  it('should log when data arrives and when the contact is created', async () => {
    jotformApi.getSubmission.mockResolvedValue(submission('6001'));
    contacts.create.mockResolvedValue({ id: '42' });

    await service.processSubmission('6001');

    // Nest logs its own module start-up through the same Logger; keep the service's lines only.
    const lines = logSpy.mock.calls
      .map(([message]) => String(message))
      .filter((line) => line.startsWith('Jotform submission'));
    expect(lines).toEqual([
      expect.stringContaining('6001 received'),
      expect.stringContaining('6001 synced to Bitrix24 contact 42'),
    ]);
  });

  it('should not create a second contact for a submission that is already synced', async () => {
    repository.claim.mockResolvedValue({
      outcome: 'synced',
      record: { id: 'row', submissionId: '6001', bitrixContactId: '42' },
    });

    await expect(service.processSubmission('6001')).resolves.toEqual({
      status: 'duplicate',
      submissionId: '6001',
      contactId: '42',
    });
    expect(jotformApi.getSubmission).not.toHaveBeenCalled();
    expect(contacts.create).not.toHaveBeenCalled();
  });

  it('should answer "processing" while another request owns the submission', async () => {
    repository.claim.mockResolvedValue({
      outcome: 'busy',
      record: { id: 'row', submissionId: '6001', bitrixContactId: null },
    });

    await expect(service.processSubmission('6001')).resolves.toMatchObject({
      status: 'processing',
      contactId: null,
    });
    expect(contacts.create).not.toHaveBeenCalled();
  });

  it('should reject a webhook for another form before touching anything', async () => {
    await expect(service.processSubmission('6001', '999')).rejects.toMatchObject({ status: 400 });
    expect(repository.claim).not.toHaveBeenCalled();
    expect(jotformApi.getSubmission).not.toHaveBeenCalled();
  });

  it('should reject a submission id that is not numeric', async () => {
    await expect(service.processSubmission('6001; DROP')).rejects.toMatchObject({ status: 400 });
    expect(repository.claim).not.toHaveBeenCalled();
  });

  it('should answer 503 when Jotform is not configured', async () => {
    const unconfigured = await build({ apiKey: undefined });

    await expect(unconfigured.processSubmission('6001')).rejects.toMatchObject({ status: 503 });
    expect(repository.claim).not.toHaveBeenCalled();
  });

  it('should mark the submission INVALID and answer 422 when the data is unusable', async () => {
    jotformApi.getSubmission.mockResolvedValue(submission('6001', 'not-an-email'));

    await expect(service.processSubmission('6001')).rejects.toMatchObject({
      status: 422,
      response: expect.objectContaining({ message: ['Email không hợp lệ'] }),
    });
    expect(repository.markFailed).toHaveBeenCalledWith('row-6001', 'INVALID', 'Email không hợp lệ');
    expect(contacts.create).not.toHaveBeenCalled();
  });

  it('should mark the submission INVALID when Jotform says it belongs to another form', async () => {
    jotformApi.getSubmission.mockResolvedValue({ ...submission('6001'), form_id: '999' });

    await expect(service.processSubmission('6001')).rejects.toMatchObject({ status: 400 });
    expect(repository.markFailed).toHaveBeenCalledWith(
      'row-6001',
      'INVALID',
      'Submission không thuộc biểu mẫu đã cấu hình',
    );
  });

  it.each([
    ['auth', 503],
    ['not_found', 404],
    ['timeout', 504],
    ['network', 502],
    ['upstream', 502],
  ] as const)(
    'should map a Jotform "%s" failure to HTTP %i and keep it retryable',
    async (kind, status) => {
      jotformApi.getSubmission.mockRejectedValue(new JotformApiError('boom', kind));

      await expect(service.processSubmission('6001')).rejects.toMatchObject({ status });
      expect(repository.markFailed).toHaveBeenCalledWith('row-6001', 'FAILED', 'boom');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('6001 failed'));
    },
  );

  it('should explain both causes of a Jotform 401, which look the same from outside', async () => {
    jotformApi.getSubmission.mockRejectedValue(new JotformApiError('not authorized', 'auth', 401));

    await expect(service.processSubmission('6001')).rejects.toMatchObject({
      status: 503,
      message: expect.stringMatching(/API Key.*submission/),
    });
  });

  it('should mark the submission FAILED and pass the error on when Bitrix24 fails', async () => {
    jotformApi.getSubmission.mockResolvedValue(submission('6001'));
    contacts.create.mockRejectedValue(new BadGatewayException('Bitrix24 request thất bại'));

    await expect(service.processSubmission('6001')).rejects.toBeInstanceOf(BadGatewayException);
    expect(repository.markFailed).toHaveBeenCalledWith(
      'row-6001',
      'FAILED',
      'Bitrix24 request thất bại',
    );
    expect(repository.markSynced).not.toHaveBeenCalled();
  });

  describe('syncForm', () => {
    it('should process the listed submissions oldest first without re-reading each one', async () => {
      jotformApi.listSubmissions.mockResolvedValue([submission('6003'), submission('6002')]);
      contacts.create.mockResolvedValueOnce({ id: '1' }).mockResolvedValueOnce({ id: '2' });

      await expect(service.syncForm()).resolves.toEqual({
        total: 2,
        synced: 2,
        duplicate: 0,
        processing: 0,
        failed: 0,
      });
      expect(jotformApi.listSubmissions).toHaveBeenCalledWith(FORM_ID, 100);
      expect(repository.claim.mock.calls.map(([id]) => id)).toEqual(['6002', '6003']);
      expect(jotformApi.getSubmission).not.toHaveBeenCalled();
    });

    it('should count duplicates and failures and keep going after a failure', async () => {
      jotformApi.listSubmissions.mockResolvedValue([
        submission('6003'),
        submission('6002', 'bad'),
        submission('6001'),
      ]);
      repository.claim
        .mockResolvedValueOnce({
          outcome: 'synced',
          record: { id: 'row', submissionId: '6001', bitrixContactId: '7' },
        })
        .mockImplementation((id: string) => Promise.resolve(claimed(id)));
      contacts.create.mockResolvedValue({ id: '9' });

      await expect(service.syncForm()).resolves.toEqual({
        total: 3,
        synced: 1,
        duplicate: 1,
        processing: 0,
        failed: 1,
      });
    });

    it('should answer 502 when the submission list cannot be read', async () => {
      jotformApi.listSubmissions.mockRejectedValue(new JotformApiError('down', 'network'));

      await expect(service.syncForm()).rejects.toMatchObject({ status: 502 });
    });
  });
});
