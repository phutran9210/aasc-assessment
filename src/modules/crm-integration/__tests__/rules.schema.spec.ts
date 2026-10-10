import { rulesSchema } from '../schemas/rules.schema.js';

const scoring = {
  weights: { email: 15, phone: 15, form: 20, interaction: 20, budget: 15, timeline: 15 },
  interaction_window_days: 30,
  interaction_points: 5,
  interaction_cap: 4,
};

const base = () => ({
  schema_version: 1,
  auto_conversion: { enabled: true },
  manual_conversion: {
    enabled: true,
    fallback_sales_id: '7',
    pipeline_id: 1,
    stage_id: 'NEW',
    probability: 10,
  },
  stage_probabilities: [],
  assignment: { strategy: 'fallback', fallback_sales_id: '7', sales_ids: ['7'] },
  quality_scoring: scoring,
  feedback: { enabled: false },
  reporting: { timezone: 'Asia/Ho_Chi_Minh' },
  alerts: { enabled: false },
  rules: [] as unknown[],
});

const rule = (conditions: unknown, id = 'rule-1') => ({
  id,
  priority: 1,
  enabled: true,
  conditions,
  action: 'create_deal',
  pipeline_id: 1,
  stage_id: 'NEW',
  probability: 10,
  assignment: {},
});

describe('rulesSchema', () => {
  it('accepts all predicate operators and recursively nested all/any conditions', () => {
    const document = base();
    document.rules = [
      rule({
        all: [
          { field: 'lead.email', op: 'exists' },
          { field: 'lead.city', op: 'eq', value: 'Hanoi' },
          { field: 'lead.campaign_id', op: 'in', value: ['1', '2'] },
          {
            any: [
              { field: 'lead.campaign_name', op: 'contains', value: 'Summer' },
              { field: 'lead.quality_score', op: 'gte', value: 70 },
              { field: 'lead.quality_score', op: 'lte', value: 100 },
            ],
          },
        ],
      }),
    ];

    expect(rulesSchema.parse(document).rules).toHaveLength(1);
  });

  it.each([
    [{ field: 'lead.email', op: 'exists', value: true }],
    [{ field: 'lead.email', op: 'eq' }],
    [{ field: 'lead.email', op: 'in', value: 'one' }],
    [{ field: 'lead.email', op: 'eq', value: ['one'] }],
    [{ field: 'lead.quality_score', op: 'gte', value: 'high' }],
    [{ field: 'lead.campaign_name', op: 'contains', value: 3 }],
  ])('rejects invalid predicate shape %j', (condition) => {
    const document = base();
    document.rules = [rule(condition)];
    expect(() => rulesSchema.parse(document)).toThrow();
  });

  it('rejects duplicate IDs, unknown fields, and conditions beyond safety limits', () => {
    const duplicate = base();
    duplicate.rules = [
      rule({ field: 'lead.email', op: 'exists' }, 'same'),
      rule({ field: 'lead.phone', op: 'exists' }, 'same'),
    ];
    expect(() => rulesSchema.parse(duplicate)).toThrow('rule IDs must be unique');

    const unknown = base();
    unknown.rules = [rule({ field: 'lead.password', op: 'exists' })];
    expect(() => rulesSchema.parse(unknown)).toThrow('is not allowed');

    const deep = base();
    deep.rules = [
      rule({
        all: [
          {
            all: [
              {
                all: [
                  {
                    all: [
                      {
                        all: [{ field: 'lead.email', op: 'exists' }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ];
    expect(() => rulesSchema.parse(deep)).toThrow('rule condition limits exceeded');
  });
});
