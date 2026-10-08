import { nowIso, nowMs, Temporal } from '@common/utils/index.js';
import { BaseRepository } from '@core/database/repositories/base.repository.js';

import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BitrixInstallation } from '../entities/bitrix-installation.entity.js';
import { BITRIX_MESSAGES } from '../messages/index.js';
import type { BitrixInstallationStore } from '../ports/bitrix-installation-store.port.js';
import type {
  BitrixInstallationSnapshot,
  RefreshLease,
} from '../types/bitrix-installation-snapshot.type.js';
import type { BitrixTokenSet } from '../types/index.js';

@Injectable()
export class BitrixInstallationRepository
  extends BaseRepository<BitrixInstallation>
  implements BitrixInstallationStore
{
  constructor(dataSource: DataSource) {
    super(dataSource, BitrixInstallation);
  }

  // TypeORM rejects findOne() without a where clause, so take the newest row via find().
  async findCurrent(): Promise<BitrixInstallationSnapshot | null> {
    const [current] = await this.repo.find({ order: { updatedAt: 'DESC' }, take: 1 });
    return current ? toSnapshot(current) : null;
  }

  /**
   * Stores the tokens of an install. Another portal may not overwrite the stored installation,
   * unless the caller vouches for it with `allowPortalChange` (the admin pointed BITRIX24_DOMAIN
   * at the new portal): then the single row is rewritten for that portal.
   */
  async saveTokens(
    input: BitrixTokenSet,
    options: { allowPortalChange?: boolean } = {},
  ): Promise<BitrixInstallationSnapshot> {
    const current = await this.findCurrent();
    if (current && current.memberId !== input.memberId && !options.allowPortalChange) {
      throw new ConflictException(BITRIX_MESSAGES.ERROR.INSTALLATION_MISMATCH);
    }

    const installation = this.repo.create({
      ...(current ?? {}),
      memberId: input.memberId,
      domain: input.domain,
      scope: input.scope,
      status: input.status,
      clientEndpoint: input.clientEndpoint,
      serverEndpoint: input.serverEndpoint,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      applicationToken: input.applicationToken,
      accessTokenExpiresAt: expiresAt(input.expiresIn),
      // A (re)install supersedes any refresh in flight.
      refreshLockedUntil: null,
    });

    return toSnapshot(await this.repo.save(installation));
  }

  /**
   * Claims the right to refresh for `leaseMs`. One atomic UPDATE, so of several processes only
   * one gets `true`. It also fails when `refreshToken` is no longer the stored one, i.e. someone
   * else already refreshed. An expired lease can be claimed again, so a crash cannot block
   * refreshing forever.
   */
  async acquireRefreshLock(
    id: string,
    refreshToken: string,
    leaseMs: number,
  ): Promise<RefreshLease | null> {
    const now = nowMs();
    const leaseUntil = now + leaseMs;
    const result = await this.repo
      .createQueryBuilder()
      .update()
      .set({ refreshLockedUntil: leaseUntil })
      .where('id = :id AND refreshToken = :refreshToken', { id, refreshToken })
      .andWhere('(refreshLockedUntil IS NULL OR refreshLockedUntil <= :now)', { now })
      .execute();
    return result.affected === 1
      ? { installationId: id, ownerToken: String(leaseUntil), expiresAt: new Date(leaseUntil) }
      : null;
  }

  async releaseRefreshLock(lease: RefreshLease): Promise<void> {
    await this.repo.update(
      { id: lease.installationId, refreshLockedUntil: Number(lease.ownerToken) },
      { refreshLockedUntil: null },
    );
  }

  /**
   * Stores a refreshed token pair only if `expectedRefreshToken` is still the stored one, and
   * frees the lock. Returns false, changing nothing, when a reinstall wrote newer tokens meanwhile.
   */
  async replaceTokens(
    lease: RefreshLease,
    expectedRefreshToken: string,
    input: BitrixTokenSet,
  ): Promise<boolean> {
    const result = await this.repo.update(
      {
        id: lease.installationId,
        refreshToken: expectedRefreshToken,
        refreshLockedUntil: Number(lease.ownerToken),
      },
      {
        domain: input.domain,
        scope: input.scope,
        status: input.status,
        clientEndpoint: input.clientEndpoint,
        serverEndpoint: input.serverEndpoint,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        accessTokenExpiresAt: expiresAt(input.expiresIn),
        refreshLockedUntil: null,
      },
    );
    return result.affected === 1;
  }
}

function toSnapshot(installation: BitrixInstallation): BitrixInstallationSnapshot {
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

function expiresAt(expiresInSeconds: number): Date {
  const expiration = Temporal.Instant.from(nowIso()).add({ seconds: expiresInSeconds });
  return new Date(expiration.epochMilliseconds);
}
