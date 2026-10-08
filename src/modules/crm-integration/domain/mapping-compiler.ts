import { BadRequestException } from '@nestjs/common';

import type { CrmFieldMetadata, CrmMetadata } from '../ports/crm-gateway.port.js';
import { mappingSchema } from '../schemas/mapping.schema.js';

const UNSAFE_SEGMENTS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'password',
  'secret',
  'token',
  'credential',
  'authorization',
]);

export type CompiledMappingEntry = {
  sourcePath: string[];
  target: string;
  subfield: string | null;
  transforms: string[];
  owner: 'integration' | 'manual';
};

export type CompiledMapping = { entries: CompiledMappingEntry[] };

export function compileMapping(input: unknown, metadata: CrmMetadata): CompiledMapping {
  const parsed = mappingSchema.safeParse(input);
  if (!parsed.success) throw new BadRequestException('Invalid mapping configuration');

  const occupied = new Set<string>();
  const entries = parsed.data.entries.map((entry): CompiledMappingEntry => {
    const sourcePath = entry.source.split('.');
    if (
      sourcePath.length > 8 ||
      sourcePath.some(
        (segment) =>
          !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(segment) ||
          UNSAFE_SEGMENTS.has(segment.toLowerCase()),
      )
    ) {
      throw new BadRequestException('Mapping source path is unsafe');
    }

    if (UNSAFE_SEGMENTS.has(entry.target.toLowerCase()) || entry.target.startsWith('__')) {
      throw new BadRequestException('Mapping target is unsafe');
    }
    const field = findField(metadata.lead.fields, entry.target);
    if (!field || field.readOnly)
      throw new BadRequestException('Mapping target is unknown or read-only');
    if (field.name === 'fm') {
      if (!entry.subfield) throw new BadRequestException('Multifield mappings require a subfield');
    } else if (entry.subfield) {
      throw new BadRequestException('A mapping subfield is valid only for fm');
    }

    const targetKey = `${field.name}:${entry.subfield ?? ''}`;
    if (occupied.has(targetKey))
      throw new BadRequestException('Mapping target is assigned more than once');
    occupied.add(targetKey);

    return {
      sourcePath,
      target: field.name,
      subfield: entry.subfield ?? null,
      transforms: entry.transforms,
      owner: entry.owner,
    };
  });
  return { entries };
}

function findField(
  fields: Record<string, CrmFieldMetadata>,
  target: string,
): CrmFieldMetadata | undefined {
  if (Object.hasOwn(fields, target)) return fields[target];
  return Object.values(fields).find((field) => field.name === target);
}
