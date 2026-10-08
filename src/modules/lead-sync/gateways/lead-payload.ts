import { LEAD_ORIGINATOR_FIELD, LEAD_ORIGINATOR_ID } from '../constants/index.js';
import type { BitrixLeadItem, BitrixMultifield, ValidRow } from '../types/index.js';

const DEFAULT_VALUE_TYPE = 'WORK';
/** Digits compared when deciding whether two phone numbers are the same subscriber. */
const PHONE_COMPARE_DIGITS = 9;

/** `fields` of `crm.item.add` for a new lead. */
export function buildCreateFields(row: ValidRow): Record<string, unknown> {
  const fm: BitrixMultifield[] = [];
  for (const value of [row.phone, ...(row.extraPhones ?? [])]) {
    if (value) fm.push({ typeId: 'PHONE', valueType: DEFAULT_VALUE_TYPE, value });
  }
  for (const value of [row.email, ...(row.extraEmails ?? [])]) {
    if (value) fm.push({ typeId: 'EMAIL', valueType: DEFAULT_VALUE_TYPE, value });
  }

  return {
    ...row.fields,
    ...(fm.length ? { fm } : {}),
    [LEAD_ORIGINATOR_FIELD]: LEAD_ORIGINATOR_ID,
  };
}

/**
 * `fields` of `crm.item.update`. Phone and email are not appended blindly: a value the lead
 * already has is left alone; otherwise the first value of that type is replaced. Further values
 * of the same cell never replace anything: the ones the lead lacks are added. `fm` must be an
 * object keyed by the multifield id for that (an array, even with ids, appends new values); a
 * value of a type the lead does not have yet uses the keys n0, n1, ...
 */
export function buildUpdateFields(
  row: ValidRow,
  current: BitrixLeadItem | undefined,
): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...row.fields };
  const fm: Record<string, BitrixMultifield> = {};
  let added = 0;

  const set = (
    typeId: 'PHONE' | 'EMAIL',
    value: string | undefined,
    same: (a: string, b: string) => boolean,
  ): void => {
    if (!value) return;
    const existing = multifields(current, typeId);
    if (existing.some((entry) => same(entry.value ?? '', value))) return;
    const [first] = existing;
    const key = first?.id !== undefined ? String(first.id) : `n${added++}`;
    fm[key] = { typeId, valueType: first?.valueType ?? DEFAULT_VALUE_TYPE, value };
  };

  const add = (
    typeId: 'PHONE' | 'EMAIL',
    values: string[] | undefined,
    same: (a: string, b: string) => boolean,
  ): void => {
    const existing = multifields(current, typeId);
    for (const value of values ?? []) {
      if (existing.some((entry) => same(entry.value ?? '', value))) continue;
      fm[`n${added++}`] = { typeId, valueType: DEFAULT_VALUE_TYPE, value };
    }
  };

  set('PHONE', row.phone, samePhone);
  add('PHONE', row.extraPhones, samePhone);
  set('EMAIL', row.email, sameEmail);
  add('EMAIL', row.extraEmails, sameEmail);
  if (Object.keys(fm).length) fields.fm = fm;
  return fields;
}

function multifields(item: BitrixLeadItem | undefined, typeId: string): BitrixMultifield[] {
  const fm = item?.fm;
  if (!Array.isArray(fm)) return [];
  return (fm as BitrixMultifield[]).filter((entry) => entry.typeId === typeId);
}

function samePhone(a: string, b: string): boolean {
  const tail = (value: string): string => value.replace(/\D/g, '').slice(-PHONE_COMPARE_DIGITS);
  return tail(a) !== '' && tail(a) === tail(b);
}

function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
