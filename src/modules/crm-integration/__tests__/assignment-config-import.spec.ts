import { BadRequestException } from '@nestjs/common';

import { importAssignmentConfig, isAssignmentConfig } from '../domain/assignment-config-import.js';
import type { CrmStage } from '../ports/crm-gateway.port.js';

const stages: CrmStage[] = [
  { id: 'NEW', name: 'New', categoryId: 0, semantic: null },
  { id: 'C1:NEW', name: 'Pipeline new', categoryId: 1, semantic: null },
  { id: 'C1:WON', name: 'Pipeline won', categoryId: 1, semantic: 'S' },
];

// The "Bitrix24 Lead Mapping Configuration" document printed in the assignment.
const assignment = {
  field_mapping: {
    'lead_data.full_name': 'NAME',
    'lead_data.email': 'EMAIL[0][VALUE]',
    'lead_data.phone': 'PHONE[0][VALUE]',
    'lead_data.city': 'UF_CRM_CITY',
    'campaign.campaign_name': 'UF_CRM_UTM_CAMPAIGN',
    'campaign.ad_name': 'UF_CRM_AD_NAME',
    'lead_data.ttclid': 'UF_CRM_TTCLID',
  },
  deal_rules: [
    {
      condition: "campaign.campaign_name CONTAINS 'sale'",
      action: 'create_deal',
      pipeline_id: '1',
      stage_id: 'NEW',
      probability: 30,
    },
  ],
};

describe('importAssignmentConfig', () => {
  it('recognises the assignment format and nothing else', () => {
    expect(isAssignmentConfig(assignment)).toBe(true);
    expect(isAssignmentConfig({ deal_rules: [] })).toBe(true);
    expect(isAssignmentConfig({ entries: [] })).toBe(false);
    expect(isAssignmentConfig(null)).toBe(false);
  });

  it('turns the field mapping into mapping entries on normalized lead fields', () => {
    expect(importAssignmentConfig(assignment, stages).mapping).toEqual({
      entries: [
        { source: 'name', target: 'name', owner: 'integration', transforms: [] },
        { source: 'email', target: 'fm', subfield: 'EMAIL', owner: 'integration', transforms: [] },
        { source: 'phone', target: 'fm', subfield: 'PHONE', owner: 'integration', transforms: [] },
        { source: 'city', target: 'UF_CRM_CITY', owner: 'integration', transforms: [] },
        {
          source: 'campaignName',
          target: 'UF_CRM_UTM_CAMPAIGN',
          owner: 'integration',
          transforms: [],
        },
        { source: 'adName', target: 'UF_CRM_AD_NAME', owner: 'integration', transforms: [] },
        { source: 'ttclid', target: 'UF_CRM_TTCLID', owner: 'integration', transforms: [] },
      ],
    });
  });

  it('turns a deal rule into a rule on the stage code of its pipeline', () => {
    expect(importAssignmentConfig(assignment, stages).rules).toEqual([
      {
        id: 'deal-rule-1',
        priority: 10,
        enabled: true,
        conditions: { field: 'lead.campaign_name', op: 'contains', value: 'sale' },
        action: 'create_deal',
        pipeline_id: 1,
        stage_id: 'C1:NEW',
        probability: 30,
        assignment: {},
      },
    ]);
  });

  it('keeps a stage code that already belongs to the pipeline', () => {
    const [rule] =
      importAssignmentConfig(
        { deal_rules: [{ ...assignment.deal_rules[0], pipeline_id: 0, stage_id: 'NEW' }] },
        stages,
      ).rules ?? [];

    expect(rule).toMatchObject({ pipeline_id: 0, stage_id: 'NEW' });
  });

  it.each([
    [{ field_mapping: { 'lead_data.password': 'NAME' } }],
    [{ field_mapping: { 'lead_data.full_name': 42 } }],
    [{ deal_rules: [{ ...assignment.deal_rules[0], condition: 'DROP TABLE leads' }] }],
    [{ deal_rules: [{ ...assignment.deal_rules[0], condition: "secret CONTAINS 'x'" }] }],
    [{ deal_rules: [{ ...assignment.deal_rules[0], action: 'delete_lead' }] }],
    [{ deal_rules: [{ ...assignment.deal_rules[0], stage_id: 'MISSING' }] }],
    [{ deal_rules: [{ ...assignment.deal_rules[0], pipeline_id: 'one' }] }],
  ])('rejects %j', (document) => {
    expect(() => importAssignmentConfig(document, stages)).toThrow(BadRequestException);
  });

  it('leaves out the part the document does not carry', () => {
    expect(importAssignmentConfig({ deal_rules: [] }, stages)).toEqual({
      mapping: null,
      rules: [],
    });
    expect(
      importAssignmentConfig({ field_mapping: assignment.field_mapping }, stages).rules,
    ).toBeNull();
  });
});
