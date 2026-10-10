import { BadRequestException } from '@nestjs/common';

import { evaluateRules } from '../domain/rule-engine.js';
import { parseLegacyCondition } from '../domain/legacy-condition-parser.js';
import { rulesSchema } from '../schemas/rules.schema.js';
import type { RuleCondition, RulesConfig } from '../types/rule.types.js';

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
  function match(condition: RuleCondition, lead: Record<string, unknown>): string | null {
    const rules: RulesConfig = {
      ...config,
      rules: [{ ...config.rules[0], id: 'candidate', conditions: condition }],
    };
    return evaluateRules({ lead }, rules)?.rule.id ?? null;
  }

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

  it.each([
    [{ field: 'lead.city', op: 'eq', value: 'Hanoi' }, { city: 'Hanoi' }, 'candidate'],
    [{ field: 'lead.city', op: 'eq', value: 'Hanoi' }, { city: 'Hue' }, null],
    [{ field: 'lead.city', op: 'in', value: ['Hue', 'Hanoi'] }, { city: 'Hanoi' }, 'candidate'],
    [{ field: 'lead.city', op: 'in', value: ['Hue'] }, { city: 'Hanoi' }, null],
    [{ field: 'lead.city', op: 'contains', value: 'nội' }, { city: 'HÀ NỘI' }, 'candidate'],
    [{ field: 'lead.city', op: 'contains', value: 'Hue' }, { city: 42 }, null],
    [{ field: 'lead.quality_score', op: 'gte', value: 50 }, { quality_score: 50 }, 'candidate'],
    [{ field: 'lead.quality_score', op: 'gte', value: 50 }, { quality_score: 49 }, null],
    [{ field: 'lead.quality_score', op: 'lte', value: 50 }, { quality_score: 50 }, 'candidate'],
    [{ field: 'lead.quality_score', op: 'lte', value: 50 }, { quality_score: 51 }, null],
    [{ field: 'lead.email', op: 'exists' }, { email: 'a@example.test' }, 'candidate'],
    [{ field: 'lead.email', op: 'exists' }, { email: null }, null],
  ] as Array<[RuleCondition, Record<string, unknown>, string | null]>)(
    'evaluates %j against %j',
    (condition, lead, expected) => {
      expect(match(condition, lead)).toBe(expected);
    },
  );

  it('requires every all condition and accepts any matching alternative', () => {
    const condition: RuleCondition = {
      all: [
        { field: 'lead.city', op: 'eq', value: 'Hanoi' },
        {
          any: [
            { field: 'lead.email', op: 'exists' },
            { field: 'lead.phone', op: 'exists' },
          ],
        },
      ],
    };

    expect(match(condition, { city: 'Hanoi', phone: '+84901234567' })).toBe('candidate');
    expect(match(condition, { city: 'Hanoi' })).toBeNull();
    expect(match(condition, { city: 'Hue', email: 'a@example.test' })).toBeNull();
  });

  it('ignores disabled rules and breaks equal priority ties by rule ID', () => {
    const rules: RulesConfig = {
      ...config,
      rules: [
        { ...config.rules[0], id: 'z', priority: 1 },
        { ...config.rules[0], id: 'a', priority: 1 },
        { ...config.rules[0], id: 'disabled', priority: 0, enabled: false },
      ],
    };

    expect(evaluateRules({ lead: { campaign_name: 'sale' } }, rules)?.rule.id).toBe('a');
  });
});
