import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import type { CrmGateway } from '../ports/crm-gateway.port.js';
import { CRM_GATEWAY } from '../ports/crm-gateway.port.js';
import { DEFAULT_MAPPING, FALLBACK_MAPPING } from '../constants/flow.constants.js';
import { importAssignmentConfig, isAssignmentConfig } from '../domain/assignment-config-import.js';
import { compileMapping } from '../domain/mapping-compiler.js';
import type { CompiledMapping } from '../domain/mapping-compiler.js';
import { mappingSchema } from '../schemas/mapping.schema.js';
import { rulesSchema } from '../schemas/rules.schema.js';
import type { RevisionSet } from '@core/queue/types/operation.types.js';
import { ConfigurationRepository } from '../repositories/configuration.repository.js';
import type { VersionedConfig } from '../types/versioned-config.type.js';

@Injectable()
export class ConfigurationService {
  constructor(
    private readonly repository: ConfigurationRepository,
    @Inject(CRM_GATEWAY) private readonly crm: CrmGateway,
  ) {}

  async read(key: string): Promise<VersionedConfig> {
    this.validateKey(key);
    let active: Awaited<ReturnType<ConfigurationRepository['findActive']>>;
    try {
      active = await this.repository.findActive(key);
    } catch (error) {
      // Leads are synced with the built-in mapping until one is stored, so that is what is shown.
      // Revision 0 is also the If-Match value that creates the first stored mapping.
      if (key !== 'mapping' || !(error instanceof NotFoundException)) throw error;
      return {
        key,
        revision: 0,
        etag: etag(0),
        value: DEFAULT_MAPPING,
        compiled: FALLBACK_MAPPING,
      };
    }
    return this.versioned(key, active);
  }

  async replaceFromIfMatch(
    key: string,
    value: unknown,
    ifMatch: string | undefined,
    actorId: string,
  ): Promise<VersionedConfig> {
    return this.replace(key, value, parseIfMatch(ifMatch), actorId);
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

    if (isAssignmentConfig(value)) {
      return this.replaceFromAssignment(key, value, expectedRevision, actorId);
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
    return this.versioned(key, stored);
  }

  /**
   * Stores a document in the format of the assignment (`field_mapping`, `deal_rules`). The field
   * mapping becomes the mapping configuration. Deal rules replace the rule list of the active rules
   * policy; its other sections (assignment, scoring, feedback...) have no counterpart in that
   * format and are kept. Everything is validated before the first write.
   */
  private async replaceFromAssignment(
    key: string,
    value: unknown,
    expectedRevision: number,
    actorId: string,
  ): Promise<VersionedConfig> {
    if (key !== 'mapping' && key !== 'rules') {
      throw new BadRequestException('Configuration key is not supported yet');
    }
    const metadata = await this.crm.metadata();
    const imported = importAssignmentConfig(value, metadata.stages);
    if (key === 'mapping' && !imported.mapping) {
      throw new BadRequestException('field_mapping is required');
    }
    if (key === 'rules' && !imported.rules) {
      throw new BadRequestException('deal_rules is required');
    }

    let rules: { value: Record<string, unknown>; expectedRevision: number } | null = null;
    if (imported.rules) {
      let active: Awaited<ReturnType<ConfigurationRepository['findActive']>>;
      try {
        active = await this.repository.findActive('rules');
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
        throw new BadRequestException(
          'deal_rules extend a rules policy: store one with PUT /api/v1/config/rules first',
        );
      }
      const next = this.validateValue('rules', { ...active.value, rules: imported.rules });
      validateRulesMetadata(next, metadata);
      rules = {
        value: next,
        expectedRevision: key === 'rules' ? expectedRevision : active.entity.revision,
      };
    }

    let stored: Awaited<ReturnType<ConfigurationRepository['compareAndSet']>> | null = null;
    if (key === 'mapping' && imported.mapping) {
      stored = await this.repository.compareAndSet({
        key: 'mapping',
        expectedRevision,
        value: imported.mapping,
        compiled: compileMapping(imported.mapping, metadata),
        actorId,
      });
    }
    if (rules) {
      const storedRules = await this.repository.compareAndSet({
        key: 'rules',
        expectedRevision: rules.expectedRevision,
        value: rules.value,
        compiled: null,
        actorId,
      });
      stored ??= storedRules;
    }
    if (!stored) throw new BadRequestException('Nothing to store');
    return this.versioned(key, stored);
  }

  private versioned(
    key: string,
    stored: Awaited<ReturnType<ConfigurationRepository['findActive']>>,
  ): VersionedConfig {
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

function parseIfMatch(value: string | undefined): number {
  if (!value) throw new HttpException('If-Match is required', HttpStatus.PRECONDITION_REQUIRED);
  const match = /^"(0|[1-9]\d*)"$/.exec(value.trim());
  if (!match) throw new HttpException('If-Match is invalid', HttpStatus.BAD_REQUEST);
  const revision = Number(match[1]);
  if (!Number.isSafeInteger(revision))
    throw new HttpException('If-Match is invalid', HttpStatus.BAD_REQUEST);
  return revision;
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
