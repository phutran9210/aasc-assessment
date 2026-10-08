import 'reflect-metadata';

import { DataSource } from 'typeorm';

import type { TiktokAppConfig } from '../../../config/tiktok-app/env.validation.js';
import { TIKTOK_ENTITIES } from './entities.js';
import { Foundation1791417600000 } from './migrations/1791417600000-foundation.js';
import { IntegrationDomain1791417601000 } from './migrations/1791417601000-integration-domain.js';
import { BitrixInstallationFields1791417602000 } from './migrations/1791417602000-bitrix-installation-fields.js';
import { LeadIngestSupport1791417603000 } from './migrations/1791417603000-lead-ingest-support.js';
import { LeadInterests1791417604000 } from './migrations/1791417604000-lead-interests.js';
import { LeadTimeline1791417605000 } from './migrations/1791417605000-lead-timeline.js';
import { TimelineOperationKind1791417606000 } from './migrations/1791417606000-timeline-operation-kind.js';
import { DealPollCheckpoint1791417607000 } from './migrations/1791417607000-deal-poll-checkpoint.js';

export function buildTiktokDataSource(config: TiktokAppConfig): DataSource {
  return new DataSource({
    type: 'postgres',
    url: config.databaseUrl,
    schema: config.databaseSchema,
    entities: [...TIKTOK_ENTITIES],
    migrations: [
      Foundation1791417600000,
      IntegrationDomain1791417601000,
      BitrixInstallationFields1791417602000,
      LeadIngestSupport1791417603000,
      LeadInterests1791417604000,
      LeadTimeline1791417605000,
      TimelineOperationKind1791417606000,
      DealPollCheckpoint1791417607000,
    ],
    migrationsTableName: 'migrations',
    migrationsTransactionMode: 'all',
    migrationsRun: false,
    synchronize: false,
    logging: false,
  });
}
