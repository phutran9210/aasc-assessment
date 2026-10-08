import { BadRequestException } from '@nestjs/common';

import type { CompiledMapping, CompiledMappingEntry } from './mapping-compiler.js';
import type { CrmFieldSet, NormalizedLeadInput } from '../types/normalized-lead.type.js';

const ALLOWED_TRANSFORMS = new Set(['trim', 'lowercase', 'uppercase', 'nfc']);
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

export function applyMapping(input: NormalizedLeadInput, compiled: CompiledMapping): CrmFieldSet {
  const fields: CrmFieldSet = {};
  const multifields: Array<{ typeId: string; valueType: 'WORK'; value: string }> = [];
  const occupiedTargets = new Set<string>();

  for (const entry of compiled.entries) {
    validateEntry(entry);
    const value = getPath(input, entry.sourcePath);
    if (value === undefined || value === null) continue;
    const transformed = transform(value, entry.transforms);
    if (transformed === undefined || transformed === null || transformed === '') continue;
    if (entry.target === 'fm') {
      if (!entry.subfield || typeof transformed !== 'string') continue;
      if (
        !multifields.some((field) => field.typeId === entry.subfield && field.value === transformed)
      ) {
        multifields.push({ typeId: entry.subfield, valueType: 'WORK', value: transformed });
      }
      continue;
    }
    if (occupiedTargets.has(entry.target))
      throw new BadRequestException('Mapping target is assigned more than once');
    occupiedTargets.add(entry.target);
    fields[entry.target] = transformed;
  }

  if (multifields.length) fields.fm = multifields;
  if (!occupiedTargets.has('title')) fields.title = buildTitle(input, compiled.titleMaxLength);
  return fields;
}

function validateEntry(entry: CompiledMappingEntry): void {
  if (
    !/^[A-Za-z][A-Za-z0-9_]{0,127}$/u.test(entry.target) ||
    entry.target.startsWith('__') ||
    UNSAFE_SEGMENTS.has(entry.target.toLowerCase())
  ) {
    throw new BadRequestException('Mapping target is unsafe');
  }
  if (entry.target === 'fm') {
    if (!['EMAIL', 'PHONE', 'IM', 'WEB'].includes(entry.subfield ?? '')) {
      throw new BadRequestException('Mapping multifield type is invalid');
    }
  } else if (entry.subfield) {
    throw new BadRequestException('A mapping subfield is valid only for fm');
  }
  if (
    entry.sourcePath.length < 1 ||
    entry.sourcePath.length > 8 ||
    entry.sourcePath.some(
      (segment) =>
        !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(segment) ||
        UNSAFE_SEGMENTS.has(segment.toLowerCase()),
    )
  ) {
    throw new BadRequestException('Mapping source path is unsafe');
  }
  if (entry.transforms.some((transformName) => !ALLOWED_TRANSFORMS.has(transformName))) {
    throw new BadRequestException('Mapping transform is invalid');
  }
}

function getPath(root: unknown, path: string[]): unknown {
  let value: unknown = root;
  for (const segment of path) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, segment)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function transform(value: unknown, transforms: string[]): unknown {
  if (typeof value !== 'string') return value;
  return transforms.reduce((result, transformName) => {
    switch (transformName) {
      case 'trim':
        return result.trim();
      case 'lowercase':
        return result.toLowerCase();
      case 'uppercase':
        return result.toUpperCase();
      case 'nfc':
        return result.normalize('NFC');
      default:
        throw new BadRequestException('Mapping transform is invalid');
    }
  }, value);
}

function buildTitle(input: NormalizedLeadInput, maxLength = 255): string {
  const form = input.formName ?? input.formId ?? 'Lead';
  const limit = Number.isSafeInteger(maxLength) && maxLength > 0 ? maxLength : 255;
  return Array.from(`TikTok - ${input.name} - ${form}`).slice(0, limit).join('');
}
