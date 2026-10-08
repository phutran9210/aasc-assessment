import { BadRequestException } from '@nestjs/common';

import { evaluateRules } from '../domain/rule-engine.js';
import { parseLegacyCondition } from '../domain/legacy-condition-parser.js';
import { rulesSchema } from '../schemas/rules.schema.js';
import type { RulesConfig } from '../types/rule.types.js';

const config: RulesConfig = {
  schema_version: 1,
  auto_conversion: { enabled: true },
  manual_conversion: {
    enabled: true,
    pipeline_id: 0,
    stage_id: 'NEW',
    probability: 10,
    fallback_sales_id: '1',
  },
  stage_probabilities: [],
  assignment: { strategy: 'fallback', fallback_sales_id: '1', sales_ids: ['1'] },
  quality_scoring: {
    weights: { email: 15, phone: 15, form: 20, interaction: 20, budget: 15, timeline: 15 },
    interaction_window_days: 30,
    interaction_points: 5,
    interaction_cap: 4,
  },
  feedback: { enabled: false },
  reporting: { timezone: 'Asia/Ho_Chi_Minh' },
  alerts: { enabled: true },
  rules: [
    {
      id: 'later',
      priority: 5,
      enabled: true,
      conditions: { field: 'lead.campaign_name', op: 'contains', value: 'sale' },
      action: 'create_deal',
      pipeline_id: 0,
      stage_id: 'NEW',
      probability: 10,
      assignment: { sales_id: '1' },
    },
    {
      id: 'first',
      priority: 1,
      enabled: true,
      conditions: { field: 'lead.campaign_name', op: 'contains', value: 'sale' },
      action: 'create_deal',
      pipeline_id: 0,
      stage_id: 'NEW',
      probability: 10,
      assignment: { sales_id: '1' },
    },
  ],
};

describe('rule engine', () => {
  it('matches contains case-insensitively and selects the first priority/id rule', () => {
    expect(evaluateRules({ lead: { campaign_name: 'Spring Sale 2024' } }, config)?.rule.id).toBe(
      'first',
    );
  });

  it('does not match missing fields, including comparisons against undefined', () => {
    expect(evaluateRules({ lead: {} }, config)).toBeNull();
  });

  it('parses only the supported legacy CONTAINS string grammar', () => {
    expect(parseLegacyCondition('lead.campaign_name CONTAINS "spring sale"')).toEqual({
      field: 'lead.campaign_name',
      op: 'contains',
      value: 'spring sale',
    });
    expect(() => parseLegacyCondition('lead.city == process.exit()')).toThrow(BadRequestException);
  });

  it('rejects unknown paths, excessive nesting, predicate counts, and executable expressions', () => {
    expect(() =>
      evaluateRules(
        { lead: {} },
        {
          ...config,
          rules: [{ ...config.rules[0], conditions: { field: 'lead.password', op: 'exists' } }],
        },
      ),
    ).toThrow(BadRequestException);
    expect(
      rulesSchema.safeParse({
        ...config,
        rules: [
          {
            ...config.rules[0],
            conditions: {
              any: [
                {
                  any: [
                    {
                      any: [{ any: [{ any: [{ field: 'lead.city', op: 'eq', value: 'Hanoi' }] }] }],
                    },
                  ],
                },
              ],
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      rulesSchema.safeParse({
        ...config,
        rules: [{ ...config.rules[0], conditions: 'process.exit()' }],
      }).success,
    ).toBe(false);
  });
});
