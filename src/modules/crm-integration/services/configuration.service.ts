import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import type { CrmGateway } from '../ports/crm-gateway.port.js';
import { CRM_GATEWAY } from '../ports/crm-gateway.port.js';
import { compileMapping, type CompiledMapping } from '../domain/mapping-compiler.js';
import { mappingSchema } from '../schemas/mapping.schema.js';
import type { RevisionSet } from '../types/integration.types.js';
import { ConfigurationRepository } from '../repositories/configuration.repository.js';

export type VersionedConfig = {
  key: string;
  revision: number;
  etag: string;
  value: Record<string, unknown>;
  compiled?: CompiledMapping | null;
};

@Injectable()
export class ConfigurationService {
  constructor(
    private readonly repository: ConfigurationRepository,
    @Inject(CRM_GATEWAY) private readonly crm: CrmGateway,
  ) {}

  async read(key: string): Promise<VersionedConfig> {
    this.validateKey(key);
    const active = await this.repository.findActive(key);
    return {
      key,
      revision: active.entity.revision,
      etag: etag(active.entity.revision),
      value: active.value,
      compiled: active.compiled,
    };
  }

  async replace(
    key: string,
    value: unknown,
    expectedRevision: number,
    actorId: string,
  ): Promise<VersionedConfig> {
    this.validateKey(key);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new BadRequestException('Expected configuration revision is invalid');
    }

    // Provider metadata is read before the transaction so upstream latency does not hold a DB lock.
    const parsed = this.validateValue(key, value);
    const metadata = await this.crm.metadata();
    const compiled = compileMapping(parsed, metadata);
    const stored = await this.repository.compareAndSet({
      key,
      expectedRevision,
      value: parsed,
      compiled,
      actorId,
    });
    return {
      key,
      revision: stored.entity.revision,
      etag: etag(stored.entity.revision),
      value: stored.value,
      compiled: stored.compiled,
    };
  }

  async snapshot(tx: EntityManager): Promise<RevisionSet> {
    const revisions = await this.repository.revisions(tx);
    return {
      mapping: revisions.mapping ?? 0,
      rules: revisions.rules ?? 0,
      scoring: revisions.scoring ?? 0,
    };
  }

  private validateValue(key: string, value: unknown): Record<string, unknown> {
    if (key !== 'mapping') throw new BadRequestException('Configuration key is not supported yet');
    const result = mappingSchema.safeParse(value);
    if (!result.success) throw new BadRequestException('Invalid mapping configuration');
    return result.data;
  }

  private validateKey(key: string): void {
    if (key !== 'mapping' && key !== 'rules' && key !== 'scoring') {
      throw new BadRequestException('Configuration key is invalid');
    }
  }
}

export function configurationEtag(revision: number): string {
  return etag(revision);
}

function etag(revision: number): string {
  return `"${revision}"`;
}
