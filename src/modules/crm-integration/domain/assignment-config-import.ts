import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import type { CrmStage } from '../ports/crm-gateway.port.js';
import type { MappingConfig } from '../schemas/mapping.schema.js';
import { allowedRuleFields } from '../schemas/rules.schema.js';
import type { RuleDefinition } from '../types/rule.types.js';
import { parseLegacyCondition } from './legacy-condition-parser.js';

/**
 * Importer for the configuration document printed in the assignment:
 *
 *   { "field_mapping": { "lead_data.full_name": "NAME", ... },
 *     "deal_rules": [{ "condition": "campaign.campaign_name CONTAINS 'sale'", ... }] }
 *
 * It names webhook paths and classic Bitrix24 field codes. Both are translated to what the rest of
 * the app works with: normalized lead fields, `crm.item` field names and the rule DSL.
 */

// Webhook path in the assignment -> field of the normalized lead that a mapping reads.
const MAPPING_SOURCES: Record<string, string> = {
  'lead_data.full_name': 'name',
  'lead_data.name': 'name',
  'lead_data.email': 'email',
  'lead_data.phone': 'phone',
  'lead_data.city': 'city',
  'lead_data.ttclid': 'ttclid',
  'lead_data.utm_source': 'utm.utm_source',
  'lead_data.utm_campaign': 'utm.utm_campaign',
  'campaign.campaign_id': 'campaignId',
  'campaign.campaign_name': 'campaignName',
  'campaign.ad_id': 'adId',
  'campaign.ad_name': 'adName',
  'form.form_id': 'formId',
  'form.form_name': 'formName',
};

// Webhook path in the assignment -> field a rule condition may test.
const RULE_FIELDS: Record<string, string> = {
  'campaign.campaign_id': 'lead.campaign_id',
  'campaign.campaign_name': 'lead.campaign_name',
  'campaign.ad_id': 'lead.ad_id',
  'form.form_id': 'lead.form_id',
  'lead_data.city': 'lead.city',
  'lead_data.email': 'lead.email',
  'lead_data.phone': 'lead.phone',
};

const MULTIFIELD_TARGET = /^(EMAIL|PHONE|IM|WEB)\[\d+\]\[VALUE\]$/;
const CLASSIC_TARGETS: Record<string, string> = { NAME: 'name', TITLE: 'title' };

const documentSchema = z.strictObject({
  field_mapping: z.record(z.string().max(300), z.string().trim().min(1).max(128)).optional(),
  deal_rules: z
    .array(
      z.strictObject({
        condition: z.string().max(500),
        action: z.literal('create_deal'),
        pipeline_id: z.union([z.number().int().nonnegative(), z.string().regex(/^\d{1,9}$/)]),
        stage_id: z.string().trim().min(1).max(128),
        probability: z.number().int().min(0).max(100),
      }),
    )
    .max(100)
    .optional(),
});

export type ImportedAssignmentConfig = {
  mapping: MappingConfig | null;
  rules: RuleDefinition[] | null;
};

export function isAssignmentConfig(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    ('field_mapping' in value || 'deal_rules' in value)
  );
}

export function importAssignmentConfig(
  value: unknown,
  stages: readonly CrmStage[],
): ImportedAssignmentConfig {
  const parsed = documentSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('Invalid field_mapping or deal_rules');
  const { field_mapping: fieldMapping, deal_rules: dealRules } = parsed.data;
  return {
    mapping: fieldMapping ? { entries: Object.entries(fieldMapping).map(mappingEntry) } : null,
    rules: dealRules ? dealRules.map((rule, index) => dealRule(rule, index, stages)) : null,
  };
}

function mappingEntry([path, target]: [string, string]): MappingConfig['entries'][number] {
  const source = Object.hasOwn(MAPPING_SOURCES, path) ? MAPPING_SOURCES[path] : null;
  if (!source) throw new BadRequestException(`field_mapping source ${path} is not supported`);
  const multifield = MULTIFIELD_TARGET.exec(target);
  if (multifield) {
    return {
      source,
      target: 'fm',
      subfield: multifield[1] as 'EMAIL' | 'PHONE' | 'IM' | 'WEB',
      owner: 'integration',
      transforms: [],
    };
  }
  return {
    source,
    target: Object.hasOwn(CLASSIC_TARGETS, target) ? CLASSIC_TARGETS[target] : target,
    owner: 'integration',
    transforms: [],
  };
}

function dealRule(
  rule: NonNullable<z.infer<typeof documentSchema>['deal_rules']>[number],
  index: number,
  stages: readonly CrmStage[],
): RuleDefinition {
  const condition = parseLegacyCondition(rule.condition);
  const field = Object.hasOwn(RULE_FIELDS, condition.field)
    ? RULE_FIELDS[condition.field]
    : condition.field;
  if (!allowedRuleFields.has(field)) {
    throw new BadRequestException(`deal_rules condition field ${condition.field} is not supported`);
  }
  const pipelineId = Number(rule.pipeline_id);
  return {
    id: `deal-rule-${index + 1}`,
    priority: (index + 1) * 10,
    enabled: true,
    conditions: { ...condition, field },
    action: 'create_deal',
    pipeline_id: pipelineId,
    stage_id: stageCode(pipelineId, rule.stage_id, stages),
    probability: rule.probability,
    assignment: {},
  };
}

/**
 * Bitrix24 prefixes the stages of every pipeline but the default one, so the assignment's
 * `pipeline_id: 1, stage_id: NEW` means `C1:NEW`. A code that already belongs to the pipeline is
 * kept; one that matches no stage is refused rather than stored.
 */
function stageCode(pipelineId: number, stageId: string, stages: readonly CrmStage[]): string {
  const inPipeline = stages.filter((stage) => stage.categoryId === pipelineId);
  for (const candidate of [stageId, `C${pipelineId}:${stageId}`]) {
    if (inPipeline.some((stage) => stage.id === candidate)) return candidate;
  }
  throw new BadRequestException(`deal_rules stage ${stageId} is not in pipeline ${pipelineId}`);
}
