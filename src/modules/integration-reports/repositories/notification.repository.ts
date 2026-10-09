import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type { DataSource, EntityManager, QueryDeepPartialEntity } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { NotificationEntity } from '../entities/notification.entity.js';

@Injectable()
export class NotificationRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Inserts unless the dedup key exists; a concurrent writer of the same key gets `created=false`. */
  async insertOnce(
    values: Omit<QueryDeepPartialEntity<NotificationEntity>, 'id'> & { dedupKey: string },
    manager: EntityManager,
  ): Promise<{ id: string; created: boolean }> {
    const insert = await manager
      .createQueryBuilder()
      .insert()
      .into(NotificationEntity)
      .values({ id: uuidv7(), ...values })
      .orIgnore()
      .returning(['id'])
      .execute();
    const raw: unknown = insert.raw;
    const created = Array.isArray(raw) ? (raw[0] as { id?: string } | undefined) : undefined;
    if (created?.id) return { id: created.id, created: true };
    const existing = await manager
      .getRepository(NotificationEntity)
      .findOneOrFail({ where: { dedupKey: values.dedupKey } });
    return { id: existing.id, created: false };
  }

  findById(
    id: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<NotificationEntity | null> {
    return manager.getRepository(NotificationEntity).findOne({ where: { id } });
  }

  async markSent(id: string, sentAt: Date): Promise<void> {
    await this.dataSource.getRepository(NotificationEntity).update(id, { status: 'sent', sentAt });
  }

  /** Most recent notification among the given types; ids are time-ordered UUIDv7 values. */
  latestOfTypes(types: string[], manager: EntityManager): Promise<NotificationEntity | null> {
    return manager
      .getRepository(NotificationEntity)
      .findOne({ where: { type: In(types) }, order: { id: 'DESC' } });
  }

  /** Notifications addressed to the user or to one of the user's roles, newest first. */
  listFor(
    userId: string,
    roles: string[],
    page: number,
    limit: number,
  ): Promise<[NotificationEntity[], number]> {
    return this.dataSource
      .getRepository(NotificationEntity)
      .createQueryBuilder('notification')
      .where(
        `(notification.recipient_id = :userId OR (notification.recipient_id IS NULL AND notification.payload -> 'audience' ?| ARRAY[:...roles]))`,
        { userId, roles },
      )
      .orderBy('notification.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
  }
}
