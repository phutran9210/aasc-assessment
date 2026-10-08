import { randomUUID } from 'node:crypto';

import { createTestDatabase } from './utils/test-database.js';

describe('TikTok domain schema', () => {
  it('enforces scoped identity and one deal while preserving external IDs and decimal values', async () => {
    const database = await createTestDatabase();
    const { dataSource } = database;
    const idA = randomUUID();
    const idB = randomUUID();
    const idC = randomUUID();

    try {
      await dataSource.runMigrations({ transaction: 'all' });
      await dataSource.query(
        `INSERT INTO "${database.schema}".integration_lead
          (id, external_id, scope_key, advertiser_id, portal_key, provider_mode, name, score, first_touch_at)
         VALUES ($1, $2, 'scope-test', 'adv-test', 'portal-test', 'mock', 'Lead A', 65, now()),
                ($3, 'local-lead-b', 'scope-test', 'adv-test', 'portal-test', 'mock', 'Lead B', 20, now()),
                ($4, 'local-lead-c', 'scope-test', 'adv-test', 'portal-test', 'mock', 'Lead C', 20, now())`,
        [idA, '9876543210987654321', idB, idC],
      );
      await dataSource.query(
        `INSERT INTO "${database.schema}".integration_lead_identity
          (id, advertiser_id, identity_type, normalized_value, lead_id)
         VALUES ($1, 'adv-test', 'email', 'same@example.test', $2)`,
        [randomUUID(), idA],
      );

      await expect(
        dataSource.query(
          `INSERT INTO "${database.schema}".integration_lead_identity
            (id, advertiser_id, identity_type, normalized_value, lead_id)
           VALUES ($1, 'adv-test', 'email', 'same@example.test', $2)`,
          [randomUUID(), idB],
        ),
      ).rejects.toThrow();

      await dataSource.query(
        `INSERT INTO "${database.schema}".integration_deal
          (id, lead_id, portal_key, title, amount, currency, pipeline_id, stage_id, probability, rule_revision)
         VALUES ($1, $2, 'portal-test', 'Deal A', '9007199254740993.1234', 'VND', 'pipe', 'open', 40, 1),
                ($3, $4, 'portal-test', 'Deal B', NULL, 'VND', 'pipe', 'open', 0, 1),
                ($5, $6, 'portal-test', 'Deal C', NULL, 'VND', 'pipe', 'open', 0, 1)`,
        [randomUUID(), idA, randomUUID(), idB, randomUUID(), idC],
      );

      const lead = await dataSource.query<{ external_id: string }[]>(
        `SELECT external_id FROM "${database.schema}".integration_lead WHERE id = $1`,
        [idA],
      );
      expect(lead[0]?.external_id).toBe('9876543210987654321');

      const exactAmount = await dataSource.query<{ amount: string }[]>(
        `SELECT amount FROM "${database.schema}".integration_deal WHERE lead_id = $1`,
        [idA],
      );
      expect(exactAmount[0]?.amount).toBe('9007199254740993.1234');

      await expect(
        dataSource.query(
          `INSERT INTO "${database.schema}".integration_deal
            (id, lead_id, portal_key, title, amount, currency, pipeline_id, stage_id, probability, rule_revision)
           VALUES ($1, $2, 'portal-test', 'Duplicate deal', '1.0000', 'VND', 'pipe', 'open', 1, 1)`,
          [randomUUID(), idA],
        ),
      ).rejects.toThrow();

      const nullRemoteIds = await dataSource.query<{ count: string }[]>(
        `SELECT count(*)::text AS count FROM "${database.schema}".integration_deal WHERE bitrix_deal_id IS NULL`,
      );
      expect(Number(nullRemoteIds[0]?.count)).toBe(3);
    } finally {
      await database.close();
    }
  });
});
