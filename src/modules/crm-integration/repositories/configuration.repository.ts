import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import type { DataSource, EntityManager } from 'typeorm';

import { AuditEventEntity } from '../entities/audit-event.entity.js';
import { ConfigurationEntity } from '../entities/configuration.entity.js';
import { ConfigurationHeadEntity } from '../entities/configuration-head.entity.js';
import type { CompiledMapping } from '../domain/mapping-compiler.js';

export type StoredConfiguration = {
  entity: ConfigurationEntity;
  value: Record<string, unknown>;
  compiled: CompiledMapping | null;
};

@Injectable()
export class ConfigurationRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findActive(
    key: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<StoredConfiguration> {
    const head = await manager.getRepository(ConfigurationHeadEntity).findOne({ where: { key } });
    if (!head) throw new NotFoundException(`Configuration ${key} was not found`);
    const entity = await manager
      .getRepository(ConfigurationEntity)
      .findOne({ where: { key, revision: head.revision } });
    if (!entity) throw new Error(`Configuration head ${key}:${head.revision} is invalid`);
    return unpack(entity);
  }

  async compareAndSet(input: {
    key: string;
    expectedRevision: number;
    value: Record<string, unknown>;
    compiled: CompiledMapping | null;
    actorId: string;
  }): Promise<StoredConfiguration> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [input.key]);
      const headRepository = manager.getRepository(ConfigurationHeadEntity);
      const head = await headRepository.findOne({
        where: { key: input.key },
        lock: { mode: 'pessimistic_write' },
      });
      const currentRevision = head?.revision ?? 0;
      if (currentRevision !== input.expectedRevision) {
        throw new ConflictException('Configuration revision is stale');
      }
      const entity = manager.getRepository(ConfigurationEntity).create({
        id: uuidv7(),
        key: input.key,
        revision: currentRevision + 1,
        value: {
          config: input.value,
          compiled: input.compiled as unknown as Record<string, unknown> | null,
        },
        createdBy: input.actorId,
      });
      await manager.getRepository(ConfigurationEntity).save(entity);
      await headRepository.save({ key: input.key, revision: entity.revision });
      await manager.getRepository(AuditEventEntity).save({
        id: uuidv7(),
        scopeKey: 'configuration',
        actorId: input.actorId,
        eventType: `configuration.${input.key}.updated`,
        aggregateType: 'configuration',
        aggregateId: null,
        metadata: { key: input.key, revision: entity.revision },
      });
      return unpack(entity);
    });
  }

  async revisions(manager: EntityManager): Promise<Record<string, number>> {
    const heads = await manager.getRepository(ConfigurationHeadEntity).find();
    return Object.fromEntries(heads.map((head) => [head.key, head.revision]));
  }
}

function unpack(entity: ConfigurationEntity): StoredConfiguration {
  const wrapped = entity.value;
  if (wrapped.config && typeof wrapped.config === 'object' && !Array.isArray(wrapped.config)) {
    return {
      entity,
      value: wrapped.config as Record<string, unknown>,
      compiled:
        wrapped.compiled && typeof wrapped.compiled === 'object' && !Array.isArray(wrapped.compiled)
          ? (wrapped.compiled as CompiledMapping)
          : null,
    };
  }
  return { entity, value: wrapped, compiled: null };
}
