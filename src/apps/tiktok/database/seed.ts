import bcrypt from 'bcrypt';
import type { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { Temporal } from '@common/utils/temporal.util.js';
import type { TiktokAppConfig } from '@config/tiktok-app/env.validation.js';
import { ConfigurationEntity } from '@modules/crm-integration/entities/configuration.entity.js';
import { ConfigurationHeadEntity } from '@modules/crm-integration/entities/configuration-head.entity.js';
import type { MappingConfig } from '@modules/crm-integration/schemas/mapping.schema.js';
import type { RulesDocument } from '@modules/crm-integration/schemas/rules.schema.js';
import { IntegrationUserEntity } from '@modules/integration-auth/entities/integration-user.entity.js';
import { CampaignDailyEntity } from '@modules/integration-analytics/entities/campaign-daily.entity.js';
import { AnalyticsRevisionRepository } from '@modules/integration-analytics/repositories/analytics-revision.repository.js';
import { CampaignCostRepository } from '@modules/integration-analytics/repositories/campaign-cost.repository.js';
import { CampaignCostService } from '@modules/integration-analytics/services/campaign-cost.service.js';
import { assertDeploymentIdentity } from '../deployment-identity.js';

/** Well-known placeholder for the local demo; the seed refuses to run where it would matter. */
export const DEMO_PASSWORD = 'demo-password-change-me';
export const DEMO_CAMPAIGN_ID = 'campaign-spring-2024';
export const DEMO_USERS = [
  { username: 'demo-admin', roles: ['integration_admin'] },
  { username: 'demo-operator', roles: ['integration_operator'] },
  { username: 'demo-analyst', roles: ['integration_analyst'] },
] as const;

/** Canonical demo policy; `samples/tiktok/rules.json` is the same document. */
export const DEMO_RULES: RulesDocument = {
  schema_version: 1,
  auto_conversion: { enabled: true },
  manual_conversion: {
    enabled: true,
    pipeline_id: 1,
    stage_id: 'C1:NEW',
    probability: 10,
    fallback_sales_id: '1',
  },
  stage_probabilities: [
    { pipeline_id: 1, stage_id: 'C1:NEW', probability: 10 },
    { pipeline_id: 1, stage_id: 'C1:WON', probability: 100 },
  ],
  assignment: { strategy: 'round_robin', fallback_sales_id: '1', sales_ids: ['1'] },
  quality_scoring: {
    weights: { email: 15, phone: 15, form: 20, interaction: 20, budget: 15, timeline: 15 },
    interaction_window_days: 30,
    interaction_points: 5,
    interaction_cap: 4,
  },
  feedback: {
    enabled: true,
    event_mapping: {
      lead_qualified: 'QualifiedLead',
      deal_created: 'DealCreated',
      deal_won: 'Purchase',
    },
    matching_keys: ['email', 'phone', 'ttclid'],
    hash_email: true,
    hash_phone: true,
  },
  reporting: { timezone: 'Asia/Ho_Chi_Minh' },
  alerts: { enabled: true },
  rules: [
    {
      id: 'spring-campaign-to-sales',
      priority: 10,
      enabled: true,
      conditions: { field: 'lead.campaign_id', op: 'in', value: [DEMO_CAMPAIGN_ID] },
      action: 'create_deal',
      pipeline_id: 1,
      stage_id: 'C1:NEW',
      probability: 10,
      assignment: { sales_id: '1' },
    },
  ],
};

/** Canonical demo field mapping; `samples/tiktok/mapping.json` is the same document. */
export const DEMO_MAPPING: MappingConfig = {
  entries: [
    { source: 'name', target: 'name', owner: 'integration', transforms: ['trim'] },
    { source: 'email', target: 'fm', subfield: 'EMAIL', owner: 'integration', transforms: [] },
    { source: 'phone', target: 'fm', subfield: 'PHONE', owner: 'integration', transforms: [] },
  ],
};

export type SeedSummary = {
  identity: 'claimed' | 'verified';
  users: number;
  rulesRevision: number;
  campaignCostRows: number;
};

const DEMO_COST_DAYS = 30;
const DEMO_DAILY_SPEND = '250000';

/**
 * Idempotent demo data: deployment identity, three role accounts, the rules policy and 30 days of
 * mock campaign cost. It only runs in mock mode outside production, because it creates accounts
 * with a published password.
 */
export async function seedDemo(
  dataSource: DataSource,
  config: TiktokAppConfig,
): Promise<SeedSummary> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The demo seed creates demo credentials and never runs in production');
  }
  if (config.tiktokMode !== 'mock' || config.bitrixMode !== 'mock') {
    throw new Error('The demo seed only runs when TikTok and Bitrix24 are both in mock mode');
  }

  const identity = await assertDeploymentIdentity(dataSource, config);

  const users = dataSource.getRepository(IntegrationUserEntity);
  for (const user of DEMO_USERS) {
    if (await users.findOne({ where: { username: user.username } })) continue;
    await users.insert({
      id: uuidv7(),
      username: user.username,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
      roles: [...user.roles],
      active: true,
      authVersion: 1,
    });
  }

  const rulesRevision = await dataSource.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['rules']);
    const head = await tx
      .getRepository(ConfigurationHeadEntity)
      .findOne({ where: { key: 'rules' } });
    if (head) return head.revision;
    await tx.getRepository(ConfigurationEntity).insert({
      id: uuidv7(),
      key: 'rules',
      revision: 1,
      value: { config: DEMO_RULES, compiled: null } as never,
      createdBy: null,
    });
    await tx.getRepository(ConfigurationHeadEntity).insert({ key: 'rules', revision: 1 });
    return 1;
  });

  // Cost for the last 30 complete days, so the default campaign-performance window is complete.
  const today = Temporal.Now.zonedDateTimeISO(config.reportTimezone).toPlainDate();
  const costs = new CampaignCostService(
    new CampaignCostRepository(),
    new AnalyticsRevisionRepository(),
  );
  await dataSource.transaction((tx) =>
    costs.upsert(
      Array.from({ length: DEMO_COST_DAYS }, (_, index) => ({
        advertiserId: config.advertiserId,
        campaignId: DEMO_CAMPAIGN_ID,
        reportDate: today.subtract({ days: index + 1 }).toString(),
        reportingTimezone: config.reportTimezone,
        currency: 'VND',
        spend: DEMO_DAILY_SPEND,
        impressions: '12000',
        clicks: '340',
      })),
      'mock',
      tx,
    ),
  );

  return {
    identity,
    users: await users.count(),
    rulesRevision,
    campaignCostRows: await dataSource.getRepository(CampaignDailyEntity).count(),
  };
}
