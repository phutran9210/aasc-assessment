import { isDeepStrictEqual } from 'node:util';

import { Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';

import { OPERATION_KINDS, QUEUE_NAMES } from '@core/queue/constants/operation.constants.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import { DEFAULT_SCORE_POLICY } from '@modules/crm-integration/constants/flow.constants.js';
import {
  scoreInputFromSubmissions,
  scoreLead,
} from '@modules/crm-integration/domain/lead-score.js';
import { ConfigurationRepository } from '@modules/crm-integration/repositories/configuration.repository.js';
import { LeadRepository } from '@modules/crm-integration/repositories/lead.repository.js';
import { SubmissionRepository } from '@modules/crm-integration/repositories/submission.repository.js';
import type { ScorePolicy } from '@modules/crm-integration/types/rule.types.js';
import { AnalyticsRevisionRepository } from '../repositories/analytics-revision.repository.js';
import { AnalyticsRepository } from '../repositories/analytics.repository.js';

export const SCORE_RECOMPUTE_BATCH_SIZE = 200;

/**
 * Re-scores leads whose interactions slid out of the scoring window. A changed score bumps the
 * lead version and goes through the same unique `bitrix-lead-sync/<lead>/<version>` operation as
 * ingestion, so rules are re-evaluated by the worker under the lead's own auto-conversion policy
 * (an imported lead with `applyRules=false` is synchronized but never auto-converted here).
 */
@Injectable()
export class ScoreRecomputeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly analytics: AnalyticsRepository,
    private readonly leads: LeadRepository,
    private readonly submissions: SubmissionRepository,
    private readonly configurations: ConfigurationRepository,
    private readonly operations: OperationRepository,
    private readonly outbox: OutboxRepository,
    private readonly revisions: AnalyticsRevisionRepository,
  ) {}

  /** Returns how many leads changed score as of the given instant. */
  async run(asOf: string, batchSize = SCORE_RECOMPUTE_BATCH_SIZE): Promise<number> {
    let changed = 0;
    let cursor: string | null = null;
    for (;;) {
      const ids = await this.analytics.scoreCandidates(cursor, batchSize);
      if (!ids.length) return changed;
      for (const id of ids) {
        if (await this.dataSource.transaction((tx) => this.recompute(id, asOf, tx))) changed += 1;
      }
      cursor = ids[ids.length - 1];
    }
  }

  private async recompute(leadId: string, asOf: string, tx: EntityManager): Promise<boolean> {
    const lead = await this.leads.findByIdForUpdate(leadId, tx);
    if (!lead) return false;
    const revisions = await this.configurations.revisions(tx);
    const score = scoreLead(
      scoreInputFromSubmissions(lead, await this.submissions.findForLead(lead.id, tx)),
      await this.policy(revisions.rules ?? 0, tx),
      asOf,
    );
    // jsonb does not keep key order, so the breakdown is compared structurally.
    if (lead.score === score.total && isDeepStrictEqual(lead.scoreBreakdown, score.breakdown)) {
      return false;
    }

    lead.score = score.total;
    lead.scoreBreakdown = score.breakdown;
    lead.scoreVersion = revisions.scoring || revisions.rules || lead.scoreVersion;
    lead.version += 1;
    await this.leads.save(lead, tx);
    const operation = await this.operations.ensure(
      {
        operationKey: `bitrix-lead-sync/${lead.id}/${lead.version}`,
        kind: OPERATION_KINDS.bitrixLeadSync,
        aggregateId: lead.id,
        targetVersion: lead.version,
        payload: { leadId: lead.id, targetVersion: lead.version },
        configRevisions: {
          mapping: revisions.mapping ?? 0,
          rules: revisions.rules ?? 0,
          scoring: revisions.scoring ?? 0,
        },
      },
      tx,
    );
    await this.outbox.append(operation.id, QUEUE_NAMES.bitrixLeadSync, new Date(asOf), tx);
    await this.revisions.increment(tx);
    return true;
  }

  private async policy(revision: number, tx: EntityManager): Promise<ScorePolicy> {
    if (revision > 0) {
      const stored = await this.configurations.findRevision('rules', revision, tx);
      const value = (stored?.value.config ?? stored?.value) as Record<string, unknown> | undefined;
      const scoring = value?.quality_scoring;
      if (scoring && typeof scoring === 'object') return scoring as ScorePolicy;
    }
    return DEFAULT_SCORE_POLICY;
  }
}
