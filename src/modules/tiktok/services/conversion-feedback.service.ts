import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import type { OperationContext, OperationOutcome } from '@core/queue/types/worker.types.js';
import { ProviderHttpError } from '../adapters/mock-tiktok.adapter.js';
import { buildFeedback, type FeedbackMilestone } from '../domain/feedback-payload.js';
import { TIKTOK_FEEDBACK_PROVIDER } from '../ports/tiktok-feedback-provider.port.js';
import type {
  EventResult,
  TiktokFeedbackProvider,
} from '../ports/tiktok-feedback-provider.port.js';
import { ConfigurationRepository, FeedbackRepository } from '@modules/crm-integration/index.js';
import { OPERATION_KINDS, QUEUE_NAMES } from '@core/queue/constants/operation.constants.js';
import type { FeedbackPolicy } from '@modules/crm-integration/index.js';

@Injectable()
export class ConversionFeedbackService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configurations: ConfigurationRepository,
    private readonly operations: OperationRepository,
    private readonly outbox: OutboxRepository,
    @Inject(TIKTOK_FEEDBACK_PROVIDER) private readonly provider: TiktokFeedbackProvider,
    private readonly feedbackData: FeedbackRepository,
  ) {}

  async schedule(leadId: string, milestone: FeedbackMilestone, tx: EntityManager): Promise<void> {
    const { lead, submission } = await this.feedbackData.findLeadContext(leadId, tx);
    if (!lead) return;
    const consented =
      submission?.sendFeedback === true && submission.consent.crm_feedback_allowed === true;

    let policy: FeedbackPolicy = { enabled: false };
    let rulesRevision = 0;
    try {
      const rules = await this.configurations.findActive('rules', tx);
      policy = (rules.value.feedback ?? { enabled: false }) as FeedbackPolicy;
      rulesRevision = rules.entity.revision;
    } catch {
      // Feedback stays disabled until an explicit rules policy is available.
    }

    const built = buildFeedback(
      {
        advertiserId: lead.advertiserId,
        leadId: lead.id,
        milestone,
        occurredAt: new Date(),
        consented,
        providerMode: lead.providerMode,
        email: lead.email,
        phone: lead.phone,
        ttclid: submission?.ttclid,
      },
      policy,
    );
    const eventId =
      built.status === 'ready'
        ? built.event.eventId
        : createHash('sha256')
            .update(lead.advertiserId + '\0' + lead.id + '\0' + milestone)
            .digest('hex');
    await this.feedbackData.ensureLedger(
      {
        id: uuidv7(),
        advertiserId: lead.advertiserId,
        leadId,
        milestone,
        eventId,
        status:
          built.status === 'ready'
            ? 'queued'
            : built.status === 'skipped_no_consent'
              ? 'skipped_no_consent'
              : 'disabled',
        detail: (built.status === 'ready' ? (built.event.payload ?? {}) : {}) as never,
        lastErrorCode: null,
        operationId: null,
      },
      tx,
    );
    const ledger = await this.feedbackData.findForUpdate(lead.advertiserId, leadId, milestone, tx);
    if (!ledger || ledger.status !== 'queued' || built.status !== 'ready' || ledger.operationId)
      return;

    const operationKey = 'feedback/' + lead.advertiserId + '/' + leadId + '/' + milestone;
    const operation = await this.operations.ensure(
      {
        operationKey,
        kind: OPERATION_KINDS.tiktokFeedback,
        aggregateId: leadId,
        payload: { leadId, eventId: ledger.eventId, feedbackLedgerId: ledger.id },
        configRevisions: { rules: rulesRevision },
      },
      tx,
    );
    ledger.operationId = operation.id;
    await this.feedbackData.save(ledger, tx);
    if (operation.status === 'pending' || operation.status === 'retry_wait') {
      await this.outbox.append(operation.id, QUEUE_NAMES.tiktokFeedback, new Date(), tx);
    }
  }

  async send(operationId: string, context: OperationContext): Promise<OperationOutcome> {
    await context.assertOwnership();
    const operation = await this.operations.findById(operationId, this.dataSource.manager);
    const ledgerId = operation?.payload.feedbackLedgerId;
    if (!operation || !ledgerId)
      return { outcome: 'quarantined', errorCode: 'FEEDBACK_OPERATION_INVALID' };
    const ledger = await this.feedbackData.findById(ledgerId, this.dataSource.manager);
    if (!ledger) return { outcome: 'quarantined', errorCode: 'FEEDBACK_LEDGER_MISSING' };
    if (ledger.status === 'accepted' || ledger.status === 'skipped_no_consent')
      return { outcome: 'succeeded', remoteId: ledger.eventId };
    if (ledger.status !== 'queued' && ledger.status !== 'rejected')
      return { outcome: 'quarantined', errorCode: 'FEEDBACK_DISABLED' };

    let results: EventResult[];
    try {
      results = await this.provider.sendEvents([
        { eventId: ledger.eventId, advertiserId: ledger.advertiserId, payload: ledger.detail },
      ]);
    } catch (error) {
      const errorCode = error instanceof ProviderHttpError ? error.code : 'FEEDBACK_PROVIDER_ERROR';
      await this.feedbackData.update(
        ledger.id,
        { status: 'rejected', lastErrorCode: errorCode },
        this.dataSource.manager,
      );
      return {
        outcome: 'retry_wait',
        nextAttemptAt: new Date(
          Date.now() +
            (error instanceof ProviderHttpError && error.status === 429 ? 30_000 : 5_000),
        ),
        errorCode,
      };
    }
    const result = results.find((item) => item.eventId === ledger.eventId);
    if (!result) {
      await this.feedbackData.update(
        ledger.id,
        { status: 'rejected', lastErrorCode: 'FEEDBACK_RESULT_MISSING' },
        this.dataSource.manager,
      );
      return {
        outcome: 'retry_wait',
        nextAttemptAt: new Date(Date.now() + 5_000),
        errorCode: 'FEEDBACK_RESULT_MISSING',
      };
    }
    if (result.status === 'accepted') {
      await this.feedbackData.update(
        ledger.id,
        { status: 'accepted', lastErrorCode: null },
        this.dataSource.manager,
      );
      return { outcome: 'succeeded', remoteId: ledger.eventId };
    }
    const errorCode = result.errorCode ?? 'FEEDBACK_REJECTED';
    await this.feedbackData.update(
      ledger.id,
      { status: 'rejected', lastErrorCode: errorCode },
      this.dataSource.manager,
    );
    return {
      outcome: 'retry_wait',
      nextAttemptAt: new Date(Date.now() + 5_000),
      errorCode,
    };
  }
}
