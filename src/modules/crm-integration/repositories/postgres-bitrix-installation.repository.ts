import { randomUUID } from 'node:crypto';

import type { DataSource } from 'typeorm';

import type { BitrixInstallationStore } from '../../../modules/bitrix/ports/bitrix-installation-store.port.js';
import type {
  BitrixInstallationSnapshot,
  RefreshLease,
} from '../../../modules/bitrix/types/bitrix-installation-snapshot.type.js';
import type { BitrixTokenSet } from '../../../modules/bitrix/types/index.js';
import { BitrixInstallationEntity } from '../entities/bitrix-installation.entity.js';

/** PostgreSQL-backed installation store scoped to one configured portal key. */
export class PostgresBitrixInstallationRepository implements BitrixInstallationStore {
  private readonly repository;

  constructor(
    dataSource: DataSource,
    private readonly portalKey: string,
  ) {
    this.repository = dataSource.getRepository(BitrixInstallationEntity);
  }

  async findCurrent(): Promise<BitrixInstallationSnapshot | null> {
    const installation = await this.repository
      .createQueryBuilder('installation')
      .addSelect([
        'installation.accessToken',
        'installation.refreshToken',
        'installation.applicationToken',
        'installation.refreshLeaseToken',
      ])
      .where('installation.portalKey = :portalKey', { portalKey: this.portalKey })
      .getOne();

    return installation ? toSnapshot(installation) : null;
  }

  async saveTokens(input: BitrixTokenSet): Promise<BitrixInstallationSnapshot> {
    const current = await this.findEntity();
    const installation = this.repository.create({
      ...(current ? { id: current.id } : {}),
      portalKey: this.portalKey,
      memberId: input.memberId,
      domain: input.domain,
      clientEndpoint: input.clientEndpoint,
      serverEndpoint: input.serverEndpoint,
      scope: input.scope,
      status: input.status,
      applicationToken: input.applicationToken,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      accessTokenExpiresAt: new Date(Date.now() + input.expiresIn * 1000),
      // An install supersedes any refresh request still in flight.
      refreshLeaseUntil: null,
      refreshLeaseToken: null,
    });

    return toSnapshot(await this.repository.save(installation));
  }

  async acquireRefreshLock(
    installationId: string,
    expectedRefreshToken: string,
    leaseMs: number,
  ): Promise<RefreshLease | null> {
    const ownerToken = randomUUID();
    const expiresAt = new Date(Date.now() + leaseMs);
    const result = await this.repository
      .createQueryBuilder()
      .update(BitrixInstallationEntity)
      .set({ refreshLeaseToken: ownerToken, refreshLeaseUntil: expiresAt })
      .where('id = :installationId', { installationId })
      .andWhere('portal_key = :portalKey', { portalKey: this.portalKey })
      .andWhere('refresh_token = :expectedRefreshToken', { expectedRefreshToken })
      .andWhere('(refresh_lease_until IS NULL OR refresh_lease_until <= NOW())')
      .execute();

    return result.affected === 1 ? { installationId, ownerToken, expiresAt } : null;
  }

  async releaseRefreshLock(lease: RefreshLease): Promise<void> {
    await this.repository.update(
      {
        id: lease.installationId,
        portalKey: this.portalKey,
        refreshLeaseToken: lease.ownerToken,
      },
      { refreshLeaseToken: null, refreshLeaseUntil: null },
    );
  }

  async replaceTokens(
    lease: RefreshLease,
    expectedRefreshToken: string,
    input: BitrixTokenSet,
  ): Promise<boolean> {
    const result = await this.repository.update(
      {
        id: lease.installationId,
        portalKey: this.portalKey,
        refreshToken: expectedRefreshToken,
        refreshLeaseToken: lease.ownerToken,
      },
      {
        memberId: input.memberId,
        domain: input.domain,
        clientEndpoint: input.clientEndpoint,
        serverEndpoint: input.serverEndpoint,
        scope: input.scope,
        status: input.status,
        applicationToken: input.applicationToken,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        accessTokenExpiresAt: new Date(Date.now() + input.expiresIn * 1000),
        refreshLeaseToken: null,
        refreshLeaseUntil: null,
      },
    );
    return result.affected === 1;
  }

  private async findEntity(): Promise<BitrixInstallationEntity | null> {
    return this.repository.findOne({ where: { portalKey: this.portalKey } });
  }
}

function toSnapshot(installation: BitrixInstallationEntity): BitrixInstallationSnapshot {
  if (
    !installation.memberId ||
    !installation.clientEndpoint ||
    !installation.serverEndpoint ||
    !installation.scope ||
    !installation.status ||
    !installation.accessToken ||
    !installation.refreshToken ||
    !installation.accessTokenExpiresAt
  ) {
    throw new Error('Bitrix installation is incomplete');
  }

  return {
    id: installation.id,
    memberId: installation.memberId,
    domain: installation.domain,
    clientEndpoint: installation.clientEndpoint,
    serverEndpoint: installation.serverEndpoint,
    scope: installation.scope,
    status: installation.status,
    accessToken: installation.accessToken,
    refreshToken: installation.refreshToken,
    applicationToken: installation.applicationToken,
    accessTokenExpiresAt: installation.accessTokenExpiresAt,
  };
}
