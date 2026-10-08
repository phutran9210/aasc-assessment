import { z } from 'zod';

const scalarSchema = z.union([z.string().max(500), z.number().finite(), z.boolean()]);
const predicateSchema = z
  .strictObject({
    field: z.string().min(1).max(128),
    op: z.enum(['eq', 'in', 'contains', 'gte', 'lte', 'exists']),
    value: z.union([scalarSchema, z.array(scalarSchema).min(1).max(100)]).optional(),
  })
  .superRefine((predicate, ctx) => {
    if (predicate.op === 'exists' && predicate.value !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'exists does not accept a value', path: ['value'] });
    } else if (predicate.op !== 'exists' && predicate.value === undefined) {
      ctx.addIssue({ code: 'custom', message: 'predicate value is required', path: ['value'] });
    }
    if (predicate.op === 'in' && !Array.isArray(predicate.value)) {
      ctx.addIssue({ code: 'custom', message: 'in requires an array', path: ['value'] });
    }
    if (predicate.op !== 'in' && Array.isArray(predicate.value)) {
      ctx.addIssue({
        code: 'custom',
        message: 'array values are valid only for in',
        path: ['value'],
      });
    }
    if (['gte', 'lte'].includes(predicate.op) && typeof predicate.value !== 'number') {
      ctx.addIssue({
        code: 'custom',
        message: 'numeric comparisons require a number',
        path: ['value'],
      });
    }
    if (predicate.op === 'contains' && typeof predicate.value !== 'string') {
      ctx.addIssue({ code: 'custom', message: 'contains requires a string', path: ['value'] });
    }
  });

export const ruleConditionSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([
    predicateSchema,
    z.strictObject({ all: z.array(ruleConditionSchema).min(1).max(20) }),
    z.strictObject({ any: z.array(ruleConditionSchema).min(1).max(20) }),
  ]),
);

const scorePolicySchema = z.strictObject({
  weights: z.strictObject({
    email: z.literal(15),
    phone: z.literal(15),
    form: z.literal(20),
    interaction: z.literal(20),
    budget: z.literal(15),
    timeline: z.literal(15),
  }),
  interaction_window_days: z.literal(30),
  interaction_points: z.literal(5),
  interaction_cap: z.literal(4),
  interaction_allowlist: z.array(z.string().min(1).max(80)).max(50).optional(),
});
const pipelinePolicySchema = z.strictObject({
  pipeline_id: z.number().int().nonnegative(),
  stage_id: z.string().min(1).max(128),
  probability: z.number().int().min(0).max(100),
});
const assignmentSchema = z.strictObject({
  strategy: z.enum(['fallback', 'round_robin']),
  fallback_sales_id: z.string().min(1).max(64),
  sales_ids: z.array(z.string().min(1).max(64)).min(1).max(100),
  campaign_rules: z
    .array(z.strictObject({ campaign_id: z.string().min(1), sales_id: z.string().min(1) }))
    .max(100)
    .optional(),
  city_rules: z
    .array(z.strictObject({ city: z.string().min(1), sales_id: z.string().min(1) }))
    .max(100)
    .optional(),
});
export const allowedRuleFields = new Set([
  'lead.source',
  'lead.campaign_id',
  'lead.campaign_name',
  'lead.ad_id',
  'lead.form_id',
  'lead.city',
  'lead.budget',
  'lead.timeline',
  'lead.quality_score',
  'lead.email',
  'lead.phone',
  'lead.advertiser_id',
  'lead.event_name',
]);

export const rulesSchema = z
  .strictObject({
    schema_version: z.literal(1),
    auto_conversion: z.strictObject({ enabled: z.boolean() }),
    manual_conversion: pipelinePolicySchema.extend({
      enabled: z.boolean(),
      fallback_sales_id: z.string().min(1).max(64),
    }),
    stage_probabilities: z.array(pipelinePolicySchema).max(100),
    assignment: assignmentSchema,
    quality_scoring: scorePolicySchema,
    feedback: z.strictObject({
      enabled: z.boolean(),
      events: z.array(z.string().min(1).max(100)).max(50).optional(),
      event_mapping: z
        .strictObject({
          lead_qualified: z.string().min(1).max(100).optional(),
          deal_created: z.string().min(1).max(100).optional(),
          deal_won: z.string().min(1).max(100).optional(),
        })
        .optional(),
      matching_keys: z
        .array(z.enum(['email', 'phone', 'ttclid']))
        .max(3)
        .optional(),
      hash_email: z.boolean().optional(),
      hash_phone: z.boolean().optional(),
    }),
    reporting: z.strictObject({ timezone: z.string().min(1).max(100) }),
    alerts: z.strictObject({ enabled: z.boolean() }),
    rules: z
      .array(
        z.strictObject({
          id: z.string().min(1).max(100),
          priority: z.number().int().min(0).max(1_000_000),
          enabled: z.boolean(),
          conditions: ruleConditionSchema,
          action: z.literal('create_deal'),
          pipeline_id: z.number().int().nonnegative(),
          stage_id: z.string().min(1).max(128),
          probability: z.number().int().min(0).max(100),
          assignment: z.strictObject({ sales_id: z.string().min(1).max(64).optional() }),
        }),
      )
      .max(100),
  })
  .superRefine((value, ctx) => {
    if (value.manual_conversion.enabled && !value.manual_conversion.fallback_sales_id) {
      ctx.addIssue({ code: 'custom', message: 'manual conversion requires a fallback sales ID' });
    }
    const ruleIds = new Set<string>();
    value.rules.forEach((rule, index) => {
      if (ruleIds.has(rule.id))
        ctx.addIssue({
          code: 'custom',
          message: 'rule IDs must be unique',
          path: ['rules', index, 'id'],
        });
      ruleIds.add(rule.id);
      const stats = conditionStats(rule.conditions);
      if (stats.depth > 5 || stats.predicates > 20) {
        ctx.addIssue({
          code: 'custom',
          message: 'rule condition limits exceeded',
          path: ['rules', index, 'conditions'],
        });
      }
      for (const field of conditionFields(rule.conditions)) {
        if (!allowedRuleFields.has(field)) {
          ctx.addIssue({
            code: 'custom',
            message: `rule field ${field} is not allowed`,
            path: ['rules', index, 'conditions'],
          });
        }
      }
    });
  });

export type RulesDocument = z.infer<typeof rulesSchema>;

function conditionStats(condition: unknown, depth = 1): { depth: number; predicates: number } {
  if (!condition || typeof condition !== 'object') return { depth, predicates: 0 };
  const record = condition as Record<string, unknown>;
  if (Array.isArray(record.all) || Array.isArray(record.any)) {
    const children = (record.all ?? record.any) as unknown[];
    const stats = children.map((child) => conditionStats(child, depth + 1));
    return {
      depth: Math.max(depth, ...stats.map((entry) => entry.depth)),
      predicates: stats.reduce((sum, entry) => sum + entry.predicates, 0),
    };
  }
  return { depth, predicates: 1 };
}

function conditionFields(condition: unknown): string[] {
  if (!condition || typeof condition !== 'object') return [];
  const record = condition as Record<string, unknown>;
  if (Array.isArray(record.all) || Array.isArray(record.any)) {
    return ((record.all ?? record.any) as unknown[]).flatMap(conditionFields);
  }
  return typeof record.field === 'string' ? [record.field] : [];
}
