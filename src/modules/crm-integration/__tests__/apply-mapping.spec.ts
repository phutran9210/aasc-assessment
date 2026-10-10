import { BadRequestException } from '@nestjs/common';

import { applyMapping } from '../domain/apply-mapping.js';
import type { NormalizedLeadInput } from '../types/normalized-lead.type.js';
import type { CompiledMapping } from '../domain/mapping-compiler.js';

const lead = {
  providerLeadId: 'lead-01',
  advertiserId: 'advertiser-01',
  eventKey: 'event-01',
  occurredAt: '2024-03-01T10:15:00.000Z',
  name: 'An Nguyễn',
  email: 'an+tag@example.test',
  phone: '+84901234567',
  city: 'Hà Nội',
  campaignId: 'campaign-001',
  campaignName: null,
  adId: null,
  adName: null,
  formId: 'form-01',
  formName: 'Lead Form',
  ttclid: null,
  utm: {},
  customAnswers: { budget: '5-10 triệu VND' },
  interests: ['CRM'],
  consent: { crm_feedback_allowed: true },
  isHistorical: false,
  applyRules: true,
  sendFeedback: true,
} satisfies NormalizedLeadInput;

const mapping: CompiledMapping = {
  entries: [
    {
      sourcePath: ['name'],
      target: 'name',
      subfield: null,
      transforms: ['trim'],
      owner: 'integration',
    },
    {
      sourcePath: ['email'],
      target: 'fm',
      subfield: 'EMAIL',
      transforms: ['lowercase'],
      owner: 'integration',
    },
    {
      sourcePath: ['phone'],
      target: 'fm',
      subfield: 'PHONE',
      transforms: [],
      owner: 'integration',
    },
    {
      sourcePath: ['customAnswers', 'budget'],
      target: 'UF_CRM_BUDGET',
      subfield: null,
      transforms: [],
      owner: 'manual',
    },
    {
      sourcePath: ['utm', 'campaign'],
      target: 'UF_CRM_UTM_CAMPAIGN',
      subfield: null,
      transforms: ['uppercase'],
      owner: 'integration',
    },
  ],
};

describe('applyMapping', () => {
  it('applies safe source paths and transforms, builds Bitrix multifields, and supplies a bounded title fallback', () => {
    expect(applyMapping(lead, mapping)).toEqual({
      name: 'An Nguyễn',
      fm: [
        { typeId: 'EMAIL', valueType: 'WORK', value: 'an+tag@example.test' },
        { typeId: 'PHONE', valueType: 'WORK', value: '+84901234567' },
      ],
      UF_CRM_BUDGET: '5-10 triệu VND',
      title: 'TikTok - An Nguyễn - Lead Form',
    });
  });

  it('ignores missing values and rejects unsafe paths or unrecognized transforms', () => {
    const result = applyMapping(lead, {
      entries: [{ ...mapping.entries[0], sourcePath: ['missing'] }],
    });
    expect(result).toEqual({ title: 'TikTok - An Nguyễn - Lead Form' });
    expect(() =>
      applyMapping(lead, { entries: [{ ...mapping.entries[0], sourcePath: ['__proto__'] }] }),
    ).toThrow(BadRequestException);
    expect(() =>
      applyMapping(lead, {
        entries: [{ ...mapping.entries[0], transforms: ['eval'] }],
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      applyMapping(lead, { entries: [{ ...mapping.entries[0], target: 'constructor' }] }),
    ).toThrow(BadRequestException);
  });

  it('cuts the generated title to the CRM title metadata limit', () => {
    expect(applyMapping(lead, { ...mapping, titleMaxLength: 10 }).title).toBe('TikTok - A');
  });

  it('applies Unicode and case transforms and omits empty mapped values', () => {
    const result = applyMapping(
      { ...lead, name: '  Nguye\u0302\u0303n  ', email: null },
      {
        entries: [
          { ...mapping.entries[0], transforms: ['trim', 'nfc', 'uppercase'] },
          mapping.entries[1],
        ],
      },
    );

    expect(result).toEqual({ name: 'NGUYỄN', title: 'TikTok -   Nguyễn   - Lead Form' });
  });

  it('deduplicates CRM multifields but rejects two populated mappings to one scalar field', () => {
    const emailEntry = mapping.entries[1];
    expect(applyMapping(lead, { entries: [emailEntry, emailEntry] }).fm).toEqual([
      { typeId: 'EMAIL', valueType: 'WORK', value: 'an+tag@example.test' },
    ]);
    expect(() => applyMapping(lead, { entries: [mapping.entries[0], mapping.entries[0]] })).toThrow(
      'Mapping target is assigned more than once',
    );
  });

  it.each([
    { ...mapping.entries[0], target: 'password' },
    { ...mapping.entries[0], target: '__hidden' },
    { ...mapping.entries[0], sourcePath: [] },
    { ...mapping.entries[0], sourcePath: ['customAnswers', 'constructor'] },
    { ...mapping.entries[0], subfield: 'EMAIL' },
    { ...mapping.entries[1], subfield: 'INVALID' },
  ])('rejects unsafe or contradictory mapping entry %#', (entry) => {
    expect(() => applyMapping(lead, { entries: [entry] })).toThrow(BadRequestException);
  });

  it('uses a bounded generated title when the form name is absent', () => {
    const result = applyMapping(
      { ...lead, formName: null, formId: null },
      { entries: [], titleMaxLength: -1 },
    );

    expect(result).toEqual({ title: 'TikTok - An Nguyễn - Lead' });
  });
});
