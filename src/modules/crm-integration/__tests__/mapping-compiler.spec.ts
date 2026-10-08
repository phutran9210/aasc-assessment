import { BadRequestException } from '@nestjs/common';

import { compileMapping } from '../domain/mapping-compiler.js';
import type { CrmMetadata } from '../ports/crm-gateway.port.js';

const metadata: CrmMetadata = {
  lead: {
    entityTypeId: 1,
    fields: {
      name: {
        name: 'name',
        title: 'Name',
        type: 'string',
        required: false,
        readOnly: false,
        multiple: false,
      },
      title: {
        name: 'title',
        title: 'Title',
        type: 'string',
        required: false,
        readOnly: false,
        multiple: false,
        maxLength: 128,
      },
      email: {
        name: 'email',
        title: 'Email',
        type: 'string',
        required: false,
        readOnly: false,
        multiple: false,
      },
      phone: {
        name: 'phone',
        title: 'Phone',
        type: 'string',
        required: false,
        readOnly: false,
        multiple: false,
      },
      fm: {
        name: 'fm',
        title: 'Multi fields',
        type: 'crm_multifield',
        required: false,
        readOnly: false,
        multiple: true,
      },
      UF_CRM_123: {
        name: 'UF_CRM_123',
        title: 'Company size',
        type: 'string',
        required: false,
        readOnly: false,
        multiple: false,
      },
      id: {
        name: 'id',
        title: 'ID',
        type: 'integer',
        required: false,
        readOnly: true,
        multiple: false,
      },
    },
  },
  deal: { entityTypeId: 2, fields: {} },
  stages: [],
  users: [],
};

describe('compileMapping', () => {
  it('compiles name, email/phone multifields, and custom fields with explicit ownership', () => {
    const result = compileMapping(
      {
        entries: [
          { source: 'NAME', target: 'name', owner: 'integration', transforms: ['trim'] },
          { source: 'EMAIL', target: 'fm', subfield: 'EMAIL', owner: 'integration' },
          { source: 'PHONE', target: 'fm', subfield: 'PHONE', owner: 'integration' },
          { source: 'custom_questions.company', target: 'UF_CRM_123', owner: 'manual' },
        ],
      },
      metadata,
    );

    expect(result.entries).toEqual([
      {
        sourcePath: ['NAME'],
        target: 'name',
        subfield: null,
        transforms: ['trim'],
        owner: 'integration',
      },
      {
        sourcePath: ['EMAIL'],
        target: 'fm',
        subfield: 'EMAIL',
        transforms: [],
        owner: 'integration',
      },
      {
        sourcePath: ['PHONE'],
        target: 'fm',
        subfield: 'PHONE',
        transforms: [],
        owner: 'integration',
      },
      {
        sourcePath: ['custom_questions', 'company'],
        target: 'UF_CRM_123',
        subfield: null,
        transforms: [],
        owner: 'manual',
      },
    ]);
    expect(result.titleMaxLength).toBe(128);
  });

  it('rejects unknown/read-only targets, prototype paths, duplicate writes, and embedded secrets', () => {
    expect(() =>
      compileMapping(
        { entries: [{ source: 'NAME', target: 'unknown', owner: 'integration' }] },
        metadata,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      compileMapping(
        { entries: [{ source: 'lead.__proto__.name', target: 'name', owner: 'integration' }] },
        metadata,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      compileMapping(
        { entries: [{ source: 'NAME', target: 'id', owner: 'integration' }] },
        metadata,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      compileMapping(
        {
          entries: [
            { source: 'NAME', target: 'name', owner: 'integration' },
            { source: 'OTHER', target: 'name', owner: 'integration' },
          ],
        },
        metadata,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      compileMapping(
        { entries: [{ source: 'NAME', target: 'name', owner: 'integration', token: 'secret' }] },
        metadata,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects unsupported multifield targets and the 101st mapping entry', () => {
    expect(() =>
      compileMapping(
        { entries: [{ source: 'EMAIL', target: 'fm', owner: 'integration' }] },
        metadata,
      ),
    ).toThrow(BadRequestException);
    const tooMany = Array.from({ length: 101 }, (_, index) => ({
      source: `field_${index}`,
      target: 'name',
      owner: 'integration',
    }));
    expect(() => compileMapping({ entries: tooMany }, metadata)).toThrow(BadRequestException);
  });
});
