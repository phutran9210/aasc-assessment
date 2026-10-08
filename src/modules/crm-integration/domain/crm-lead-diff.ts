import { isDeepStrictEqual } from 'node:util';

import type { CompiledMapping } from './mapping-compiler.js';

export type CrmPatch = {
  patch: Record<string, unknown>;
  lastWrittenFields: Record<string, unknown>;
};

type RecordValue = Record<string, unknown>;

export function buildLeadDiff(
  local: Record<string, unknown>,
  current: Record<string, unknown>,
  lastWritten: Record<string, unknown>,
  compiled: CompiledMapping,
): CrmPatch {
  const patch: Record<string, unknown> = {};
  const nextLastWritten = { ...lastWritten };
  const owners = new Map(
    compiled.entries.map((entry) => [`${entry.target}:${entry.subfield ?? ''}`, entry.owner]),
  );

  for (const [field, desired] of Object.entries(local)) {
    if (field === 'fm') continue;
    if (isEmpty(desired) || owners.get(`${field}:`) === 'manual') continue;
    if (wasEditedBySales(field, current[field], lastWritten)) continue;
    if (isDeepStrictEqual(current[field], desired)) continue;
    patch[field] = desired;
    nextLastWritten[field] = desired;
  }

  const localFm = arrayValue(local.fm).filter((value) => {
    const field = record(value);
    const typeId = stringValue(field.typeId ?? field.TYPE_ID);
    return (
      typeId && owners.get(`fm:${typeId}`) !== 'manual' && !isEmpty(field.value ?? field.VALUE)
    );
  });
  if (localFm.length) {
    const currentFm = arrayValue(current.fm);
    const currentKeys = new Set(currentFm.map(multifieldKey));
    const salesEditedTypes = new Set(
      arrayValue(lastWritten.fm)
        .filter((written) => !currentKeys.has(multifieldKey(written)))
        .map((written) => stringValue(record(written).typeId ?? record(written).TYPE_ID))
        .filter((type): type is string => type !== null),
    );
    const union = [...currentFm];
    const writtenFm: unknown[] = [...arrayValue(lastWritten.fm)];
    let added = false;
    for (const desired of localFm) {
      const type = stringValue(record(desired).typeId ?? record(desired).TYPE_ID);
      if (type && salesEditedTypes.has(type)) continue;
      const key = multifieldKey(desired);
      if (union.some((item) => multifieldKey(item) === key)) continue;
      union.push(desired);
      writtenFm.push(desired);
      added = true;
    }
    if (added) {
      patch.fm = union;
      nextLastWritten.fm = writtenFm;
    }
  }

  return { patch, lastWrittenFields: nextLastWritten };
}

function wasEditedBySales(
  field: string,
  remoteValue: unknown,
  lastWritten: Record<string, unknown>,
): boolean {
  return Object.hasOwn(lastWritten, field) && !isDeepStrictEqual(remoteValue, lastWritten[field]);
}

function isEmpty(value: unknown): boolean {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function multifieldKey(value: unknown): string {
  const field = record(value);
  return [
    field.typeId ?? field.TYPE_ID,
    field.valueType ?? field.VALUE_TYPE,
    field.value ?? field.VALUE,
  ]
    .map((part) => (typeof part === 'string' ? part : ''))
    .join('\u0000');
}
