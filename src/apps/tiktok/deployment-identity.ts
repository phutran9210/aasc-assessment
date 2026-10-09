import type { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import type { TiktokAppConfig } from '@config/tiktok-app/env.validation.js';
import { ConfigurationEntity } from '@modules/crm-integration/entities/configuration.entity.js';

export const DEPLOYMENT_IDENTITY_KEY = 'deployment_identity';

export type DeploymentIdentity = Pick<
  TiktokAppConfig,
  'advertiserId' | 'portalKey' | 'tiktokMode' | 'bitrixMode'
>;

/**
 * A database belongs to one advertiser, one portal and one provider mode for its whole life. The
 * first start records that identity; every later start (API, worker or seed) must present the
 * same one, so mock data can never be mixed with a real account by changing an environment file.
 */
export async function assertDeploymentIdentity(
  dataSource: DataSource,
  config: DeploymentIdentity,
): Promise<'claimed' | 'verified'> {
  const identity: DeploymentIdentity = {
    advertiserId: config.advertiserId,
    portalKey: config.portalKey,
    tiktokMode: config.tiktokMode,
    bitrixMode: config.bitrixMode,
  };
  return dataSource.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      DEPLOYMENT_IDENTITY_KEY,
    ]);
    const repository = tx.getRepository(ConfigurationEntity);
    const stored = await repository.findOne({ where: { key: DEPLOYMENT_IDENTITY_KEY } });
    if (!stored) {
      await repository.insert({
        id: uuidv7(),
        key: DEPLOYMENT_IDENTITY_KEY,
        revision: 1,
        value: identity,
        createdBy: null,
      });
      return 'claimed';
    }
    const mismatched = (Object.keys(identity) as Array<keyof DeploymentIdentity>).filter(
      (field) => stored.value[field] !== identity[field],
    );
    if (mismatched.length) {
      throw new Error(
        `Deployment identity mismatch on ${mismatched.join(', ')}: this database was initialised ` +
          'for another advertiser, portal or provider mode. Use a separate database.',
      );
    }
    return 'verified';
  });
}
