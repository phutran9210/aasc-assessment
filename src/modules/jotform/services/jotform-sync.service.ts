import { jotformConfig } from '@config/index.js';
import type { JotformConfig } from '@config/index.js';
import { ContactService } from '@modules/contact/index.js';

import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

import {
  JOTFORM_CLAIM_STALE_MS,
  JOTFORM_SUBMISSION_STATUS,
  JOTFORM_SYNC_PAGE_SIZE,
} from '../constants/index.js';
import { JotformMappingError, toContactFields } from '../mappers/jotform-submission.mapper.js';
import { JOTFORM_MESSAGES } from '../messages/index.js';
import { JotformSubmissionRepository } from '../repositories/jotform-submission.repository.js';
import { JotformApiError, JotformApiService } from './jotform-api.service.js';
import type {
  JotformSubmissionContent,
  JotformSyncOutcome,
  JotformSyncSummary,
} from '../types/index.js';

const NUMERIC_ID = /^\d+$/;

/**
 * Turns Jotform submissions into Bitrix24 contacts: claim the submission, read it from the
 * Jotform API, map the three fields, create the contact, record the result.
 */
@Injectable()
export class JotformSyncService {
  private readonly logger = new Logger(JotformSyncService.name);

  constructor(
    private readonly jotformApi: JotformApiService,
    private readonly repository: JotformSubmissionRepository,
    private readonly contactService: ContactService,
    @Inject(jotformConfig.KEY) private readonly config: JotformConfig,
  ) {}

  /**
   * Handles one submission announced by the webhook. Only the id is trusted: the answers are
   * read back from the Jotform API. Safe to call repeatedly for the same submission.
   */
  async processSubmission(submissionId: string, formId?: string): Promise<JotformSyncOutcome> {
    const configuredFormId = this.requireFormId();
    if (!NUMERIC_ID.test(submissionId)) {
      throw new BadRequestException(JOTFORM_MESSAGES.ERROR.SUBMISSION_ID_INVALID);
    }
    if (formId !== undefined && formId !== configuredFormId) {
      throw new BadRequestException(JOTFORM_MESSAGES.ERROR.FORM_MISMATCH);
    }
    return this.sync(submissionId, configuredFormId, () =>
      this.jotformApi.getSubmission(submissionId),
    );
  }

  /**
   * Catches up on submissions the webhook missed (server down, Bitrix24 unavailable): reads the
   * newest submissions of the form and processes every one that is not synced yet.
   */
  async syncForm(): Promise<JotformSyncSummary> {
    const formId = this.requireFormId();
    let submissions: JotformSubmissionContent[];
    try {
      submissions = await this.jotformApi.listSubmissions(formId, JOTFORM_SYNC_PAGE_SIZE);
    } catch (error) {
      this.logger.error(`Jotform submission list failed: ${messageOf(error)}`);
      throw this.toHttpError(error);
    }

    const summary: JotformSyncSummary = {
      total: submissions.length,
      synced: 0,
      duplicate: 0,
      processing: 0,
      failed: 0,
    };
    // Jotform lists newest first; contacts are created in the order people submitted.
    for (const submission of [...submissions].reverse()) {
      try {
        const outcome = await this.sync(submission.id, formId, () => Promise.resolve(submission));
        summary[outcome.status] += 1;
      } catch {
        // Already logged and recorded by sync(); one bad submission must not stop the rest.
        summary.failed += 1;
      }
    }
    this.logger.log(`Jotform sync finished: ${JSON.stringify(summary)}`);
    return summary;
  }

  private async sync(
    submissionId: string,
    formId: string,
    load: () => Promise<JotformSubmissionContent>,
  ): Promise<JotformSyncOutcome> {
    const { outcome, record } = await this.repository.claim(
      submissionId,
      formId,
      JOTFORM_CLAIM_STALE_MS,
    );
    if (outcome === 'synced') {
      this.logger.warn(
        `Jotform submission ${submissionId} already synced to contact ${record.bitrixContactId}`,
      );
      return { status: 'duplicate', submissionId, contactId: record.bitrixContactId };
    }
    if (outcome === 'busy') {
      this.logger.warn(`Jotform submission ${submissionId} is already being processed`);
      return { status: 'processing', submissionId, contactId: null };
    }

    this.logger.log(`Jotform submission ${submissionId} received`);
    try {
      const submission = await load();
      if (submission.form_id !== formId) {
        throw new BadRequestException(JOTFORM_MESSAGES.ERROR.FORM_MISMATCH);
      }
      const contact = await this.contactService.create(toContactFields(submission));
      await this.repository.markSynced(record.id, contact.id);
      this.logger.log(
        `Jotform submission ${submissionId} synced to Bitrix24 contact ${contact.id}`,
      );
      return { status: 'synced', submissionId, contactId: contact.id };
    } catch (error) {
      // Bad data will not get better by retrying as is; everything else might.
      const invalid = error instanceof JotformMappingError || error instanceof BadRequestException;
      const { INVALID, FAILED } = JOTFORM_SUBMISSION_STATUS;
      await this.repository.markFailed(record.id, invalid ? INVALID : FAILED, messageOf(error));
      this.logger.error(`Jotform submission ${submissionId} failed: ${messageOf(error)}`);
      throw this.toHttpError(error);
    }
  }

  private requireFormId(): string {
    if (!this.config.apiKey || !this.config.formId) {
      throw new ServiceUnavailableException(JOTFORM_MESSAGES.ERROR.CONFIG);
    }
    return this.config.formId;
  }

  private toHttpError(error: unknown): unknown {
    if (error instanceof JotformMappingError) {
      return new UnprocessableEntityException(error.problems);
    }
    if (error instanceof JotformApiError) {
      const { ERROR } = JOTFORM_MESSAGES;
      if (error.kind === 'config') return new ServiceUnavailableException(ERROR.CONFIG);
      if (error.kind === 'auth') return new ServiceUnavailableException(ERROR.AUTH);
      if (error.kind === 'not_found') return new NotFoundException(ERROR.SUBMISSION_NOT_FOUND);
      if (error.kind === 'timeout') return new GatewayTimeoutException(ERROR.TIMEOUT);
      return new BadGatewayException(ERROR.UPSTREAM);
    }
    // HttpExceptions (from ContactService or raised above) already carry the right status.
    return error;
  }
}

function messageOf(error: unknown): string {
  if (error instanceof HttpException || error instanceof Error) return error.message;
  return String(error);
}
