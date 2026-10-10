import type { QueryRunner } from 'typeorm';

import { Foundation1791417600000 } from '../migrations/1791417600000-foundation.js';
import { IntegrationDomain1791417601000 } from '../migrations/1791417601000-integration-domain.js';
import { BitrixInstallationFields1791417602000 } from '../migrations/1791417602000-bitrix-installation-fields.js';
import { LeadIngestSupport1791417603000 } from '../migrations/1791417603000-lead-ingest-support.js';
import { LeadInterests1791417604000 } from '../migrations/1791417604000-lead-interests.js';
import { LeadTimeline1791417605000 } from '../migrations/1791417605000-lead-timeline.js';
import { TimelineOperationKind1791417606000 } from '../migrations/1791417606000-timeline-operation-kind.js';
import { DealPollCheckpoint1791417607000 } from '../migrations/1791417607000-deal-poll-checkpoint.js';
import { FeedbackLedger1791417608000 } from '../migrations/1791417608000-feedback-ledger.js';

const migrations = [
  new Foundation1791417600000(),
  new IntegrationDomain1791417601000(),
  new BitrixInstallationFields1791417602000(),
  new LeadIngestSupport1791417603000(),
  new LeadInterests1791417604000(),
  new LeadTimeline1791417605000(),
  new TimelineOperationKind1791417606000(),
  new DealPollCheckpoint1791417607000(),
  new FeedbackLedger1791417608000(),
];

describe('TikTok database migrations', () => {
  it.each(migrations)(
    '$name runs forward and backward through the query runner',
    async (migration) => {
      const statements: string[] = [];
      const queryRunner = {
        connection: { options: { schema: 'integration_test' } },
        query: jest.fn((sql: string) => {
          statements.push(sql);
          return [];
        }),
      } as unknown as QueryRunner;

      await migration.up(queryRunner);
      const forwardCount = statements.length;
      expect(forwardCount).toBeGreaterThan(0);
      expect(statements.join('\n')).toMatch(/CREATE|ALTER|INSERT|UPDATE/i);

      await migration.down(queryRunner);
      expect(statements.length).toBeGreaterThan(forwardCount);
      expect(statements.slice(forwardCount).join('\n')).toMatch(/DROP|ALTER|DELETE/i);
    },
  );
});
