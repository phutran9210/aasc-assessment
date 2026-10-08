import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import type { CrmGateway } from '../ports/crm-gateway.port.js';
import { CRM_GATEWAY } from '../ports/crm-gateway.port.js';
import { compileMapping, type CompiledMapping } from '../domain/mapping-compiler.js';
import { mappingSchema } from '../schemas/mapping.schema.js';
import { rulesSchema } from '../schemas/rules.schema.js';
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
    let compiled: CompiledMapping | null = null;
    if (key === 'mapping') compiled = compileMapping(parsed, metadata);
    if (key === 'rules') validateRulesMetadata(parsed, metadata);
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
    const schema = key === 'mapping' ? mappingSchema : key === 'rules' ? rulesSchema : null;
    if (!schema) throw new BadRequestException('Configuration key is not supported yet');
    const result = schema.safeParse(value);
    if (!result.success) throw new BadRequestException(`Invalid ${key} configuration`);
    return result.data;
  }

  private validateKey(key: string): void {
    if (key !== 'mapping' && key !== 'rules' && key !== 'scoring') {
      throw new BadRequestException('Configuration key is invalid');
    }
  }
}

function validateRulesMetadata(
  value: Record<string, unknown>,
  metadata: Awaited<ReturnType<CrmGateway['metadata']>>,
): void {
  const parsed = rulesSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('Invalid rules configuration');
  const config = parsed.data;
  const policies = [
    ...config.stage_probabilities,
    config.manual_conversion,
    ...config.rules.map((rule) => ({
      pipeline_id: rule.pipeline_id,
      stage_id: rule.stage_id,
      probability: rule.probability,
    })),
  ];
  for (const policy of policies) {
    const stage = metadata.stages.find((candidate) => candidate.id === policy.stage_id);
    if (!stage || stage.categoryId !== policy.pipeline_id) {
      throw new BadRequestException('Configured stage does not belong to its pipeline');
    }
    const expectedProbability = ['won', 'S'].includes(stage.semantic ?? '')
      ? 100
      : ['lost', 'F'].includes(stage.semantic ?? '')
        ? 0
        : policy.probability;
    if (policy.probability !== expectedProbability) {
      throw new BadRequestException('Won and lost stages require probability 100 and 0');
    }
  }
  const salesIds = new Set([
    config.manual_conversion.fallback_sales_id,
    config.assignment.fallback_sales_id,
    ...config.assignment.sales_ids,
    ...(config.assignment.campaign_rules ?? []).map((rule) => rule.sales_id),
    ...(config.assignment.city_rules ?? []).map((rule) => rule.sales_id),
    ...config.rules
      .map((rule) => rule.assignment.sales_id)
      .filter((id): id is string => Boolean(id)),
  ]);
  for (const salesId of salesIds) {
    if (!metadata.users.some((user) => user.id === salesId && user.active)) {
      throw new BadRequestException('Configured assignee is not an active sales user');
    }
  }
}

export function configurationEtag(revision: number): string {
  return etag(revision);
}

function etag(revision: number): string {
  return `"${revision}"`;
}
